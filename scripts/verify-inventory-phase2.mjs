import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function assertClose(actual, expected, label) {
  const diff = Math.abs(Number(actual) - Number(expected));
  if (diff > 0.0001) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function snapshotFinance(supabase) {
  const [
    { count: expenseCount },
    { data: expenseSumRows },
    { count: incomeCount },
    { data: incomeSumRows },
    { count: payrollCount },
  ] = await Promise.all([
    supabase.from("expense_register").select("*", { count: "exact", head: true }),
    supabase.from("expense_register").select("amount"),
    supabase.from("income_register").select("*", { count: "exact", head: true }),
    supabase.from("income_register").select("amount"),
    supabase.from("payroll_history").select("*", { count: "exact", head: true }),
  ]);

  const expenseTotal = (expenseSumRows ?? []).reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0,
  );
  const incomeTotal = (incomeSumRows ?? []).reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0,
  );

  return {
    expenseCount: expenseCount ?? 0,
    expenseTotal,
    incomeCount: incomeCount ?? 0,
    incomeTotal,
    payrollCount: payrollCount ?? 0,
  };
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { error: schemaError } = await supabase
    .from("internal_consumption")
    .select("id")
    .limit(1);

  if (schemaError) {
    throw new Error(
      `internal_consumption table not available (${schemaError.message}). Run scripts/39_internal_consumption.sql first.`,
    );
  }

  const financeBefore = await snapshotFinance(supabase);
  console.log("Finance/Payroll snapshot (before):", financeBefore);

  const { data: products, error: productsError } = await supabase
    .from("finished_products")
    .select("id, product_code, product_name, unit_of_measure, current_stock")
    .gt("current_stock", 0)
    .order("product_name", { ascending: true })
    .limit(1);

  if (productsError) {
    throw new Error(productsError.message);
  }

  if (!products?.length) {
    throw new Error(
      "No finished product with stock found. Run Phase 1 verification or create stock first.",
    );
  }

  const product = products[0];
  const stockBefore = Number(product.current_stock);
  const consumeQuantity = Math.min(2, stockBefore);
  const overQuantity = stockBefore + 5;

  console.log(
    `Using product ${product.product_name} (${product.product_code}), stock before: ${stockBefore}`,
  );

  const { data: consumption, error: insertError } = await supabase
    .from("internal_consumption")
    .insert({
      product_id: product.id,
      quantity: consumeQuantity,
      consumption_date: "2026-07-14",
      reason: "Phase 2 verification — general cleaning stock",
      recorded_by: "Phase 2 verify script",
      notes: "Automated internal consumption test",
    })
    .select("id")
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  const { error: overConsumeError } = await supabase
    .from("internal_consumption")
    .insert({
      product_id: product.id,
      quantity: overQuantity,
      consumption_date: "2026-07-14",
      reason: "Should fail — exceeds stock",
      recorded_by: "Phase 2 verify script",
    });

  if (!overConsumeError) {
    throw new Error(
      "Expected over-consumption insert to be blocked, but it succeeded.",
    );
  }

  if (
    !overConsumeError.message.includes("cannot record use of") &&
    !overConsumeError.message.includes("in stock")
  ) {
    throw new Error(
      `Over-consumption error message was unclear: ${overConsumeError.message}`,
    );
  }

  console.log("Over-consumption correctly blocked:", overConsumeError.message);

  const [
    { data: productAfter, error: productAfterError },
    { data: movements, error: movementsError },
  ] = await Promise.all([
    supabase
      .from("finished_products")
      .select("current_stock")
      .eq("id", product.id)
      .single(),
    supabase
      .from("stock_movements")
      .select("movement_type, quantity, reference_id, product_id")
      .eq("reference_id", consumption.id),
  ]);

  if (productAfterError || movementsError) {
    throw new Error(productAfterError?.message ?? movementsError?.message);
  }

  assertClose(
    productAfter.current_stock,
    stockBefore - consumeQuantity,
    "Finished product stock after internal consumption",
  );

  if (!movements?.length) {
    throw new Error("Expected a stock_movements row for internal consumption.");
  }

  const movement = movements[0];
  if (movement.movement_type !== "internal_consumption_out") {
    throw new Error(
      `Expected movement_type internal_consumption_out, got ${movement.movement_type}`,
    );
  }

  assertClose(movement.quantity, consumeQuantity, "Stock movement quantity");

  const financeAfter = await snapshotFinance(supabase);
  console.log("Finance/Payroll snapshot (after):", financeAfter);

  const financeUnchanged =
    financeBefore.expenseCount === financeAfter.expenseCount &&
    financeBefore.incomeCount === financeAfter.incomeCount &&
    financeBefore.payrollCount === financeAfter.payrollCount &&
    Math.abs(financeBefore.expenseTotal - financeAfter.expenseTotal) < 0.01 &&
    Math.abs(financeBefore.incomeTotal - financeAfter.incomeTotal) < 0.01;

  if (!financeUnchanged) {
    throw new Error(
      "Finance/Payroll source tables changed during internal consumption test.",
    );
  }

  console.log("\nPhase 2 internal consumption verification passed.");
  console.log({
    product: product.product_name,
    stockBefore,
    stockAfter: productAfter.current_stock,
    consumed: consumeQuantity,
    consumptionId: consumption.id,
    stockMovement: movement,
  });
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
