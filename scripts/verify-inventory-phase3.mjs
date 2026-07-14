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

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { error: schemaError } = await supabase
    .from("income_register")
    .select("entry_type, product_id, sale_quantity, unit_price, cogs_expense_id")
    .limit(1);

  if (schemaError) {
    throw new Error(
      `income_register product-sale columns not available (${schemaError.message}). Run scripts/40_external_sales.sql first.`,
    );
  }

  const { data: products, error: productsError } = await supabase
    .from("finished_products")
    .select(
      "id, product_code, product_name, unit_of_measure, current_stock, standard_selling_price",
    )
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
  const saleQuantity = Math.min(1, stockBefore);
  const unitPrice = Number(product.standard_selling_price ?? 10);
  const expectedAmount = Math.round(saleQuantity * unitPrice * 10000) / 10000;
  const invoiceNo = `PH3-${Date.now()}`;

  console.log(
    `Using product ${product.product_name} (${product.product_code}), stock before: ${stockBefore}`,
  );

  const { count: expenseCountBefore } = await supabase
    .from("expense_register")
    .select("*", { count: "exact", head: true });

  const { data: incomeId, error: saleError } = await supabase.rpc(
    "create_product_sale",
    {
      p_date: "2026-07-14",
      p_invoice_no: invoiceNo,
      p_client_id: null,
      p_customer_name: "Phase 3 verify payer",
      p_product_id: product.id,
      p_quantity: saleQuantity,
      p_unit_price: unitPrice,
      p_amount_received: 0,
      p_payment_status: "Pending",
      p_due_date: "2026-07-15",
      p_description: null,
      p_notes: "Automated Phase 3 product sale test",
    },
  );

  if (saleError) {
    throw new Error(saleError.message);
  }

  const [
    { data: incomeRow, error: incomeError },
    { data: productAfter, error: productAfterError },
    { data: movements, error: movementsError },
    { count: expenseCountAfter },
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select(
        "id, entry_type, amount, product_id, sale_quantity, unit_price, cogs_expense_id",
      )
      .eq("id", incomeId)
      .single(),
    supabase
      .from("finished_products")
      .select("current_stock")
      .eq("id", product.id)
      .single(),
    supabase
      .from("stock_movements")
      .select("movement_type, quantity, reference_id, product_id")
      .eq("reference_id", incomeId),
    supabase.from("expense_register").select("*", { count: "exact", head: true }),
  ]);

  if (incomeError || productAfterError || movementsError) {
    throw new Error(
      incomeError?.message ?? productAfterError?.message ?? movementsError?.message,
    );
  }

  if (incomeRow.entry_type !== "product_sale") {
    throw new Error(`Expected entry_type product_sale, got ${incomeRow.entry_type}`);
  }

  assertClose(incomeRow.amount, expectedAmount, "Income amount");
  assertClose(incomeRow.sale_quantity, saleQuantity, "Sale quantity");
  assertClose(incomeRow.unit_price, unitPrice, "Unit price");

  assertClose(
    productAfter.current_stock,
    stockBefore - saleQuantity,
    "Finished product stock after sale",
  );

  if (!movements?.length) {
    throw new Error("Expected a stock_movements row for product sale.");
  }

  const movement = movements[0];
  if (movement.movement_type !== "sale_out") {
    throw new Error(
      `Expected movement_type sale_out, got ${movement.movement_type}`,
    );
  }

  assertClose(movement.quantity, saleQuantity, "Stock movement quantity");

  if (!incomeRow.cogs_expense_id) {
    throw new Error("Expected cogs_expense_id to be linked on income row.");
  }

  const { data: cogsExpense, error: cogsError } = await supabase
    .from("expense_register")
    .select("expense_category, sub_category, receipt_no, amount, quantity")
    .eq("id", incomeRow.cogs_expense_id)
    .single();

  if (cogsError) {
    throw new Error(cogsError.message);
  }

  if (cogsExpense.expense_category !== "Cost of Goods Sold") {
    throw new Error(
      `Expected COGS expense category, got ${cogsExpense.expense_category}`,
    );
  }

  if (cogsExpense.sub_category !== "Product Sales") {
    throw new Error(
      `Expected COGS sub_category Product Sales, got ${cogsExpense.sub_category}`,
    );
  }

  if (cogsExpense.receipt_no !== `COGS-${invoiceNo}`) {
    throw new Error(
      `Expected receipt_no COGS-${invoiceNo}, got ${cogsExpense.receipt_no}`,
    );
  }

  if ((expenseCountAfter ?? 0) !== (expenseCountBefore ?? 0) + 1) {
    throw new Error("Expected exactly one new expense_register row for COGS.");
  }

  const overQuantity = stockBefore + 5;
  const { error: overSaleError } = await supabase.rpc("create_product_sale", {
    p_date: "2026-07-14",
    p_invoice_no: `PH3-OVER-${Date.now()}`,
    p_client_id: null,
    p_customer_name: "Phase 3 verify payer",
    p_product_id: product.id,
    p_quantity: overQuantity,
    p_unit_price: unitPrice,
    p_amount_received: 0,
    p_payment_status: "Pending",
    p_due_date: "2026-07-15",
    p_description: null,
    p_notes: "Should fail — exceeds stock",
  });

  if (!overSaleError) {
    throw new Error("Expected over-sale RPC to be blocked, but it succeeded.");
  }

  if (
    !overSaleError.message.includes("cannot sell") &&
    !overSaleError.message.includes("in stock")
  ) {
    throw new Error(
      `Over-sale error message was unclear: ${overSaleError.message}`,
    );
  }

  console.log("Over-sale correctly blocked:", overSaleError.message);

  const serviceInvoice = `PH3-SVC-${Date.now()}`;
  const { error: serviceError } = await supabase.from("income_register").insert({
    date: "2026-07-14",
    invoice_no: serviceInvoice,
    client_id: null,
    customer_name: "Phase 3 service regression",
    entry_type: "service",
    service_category: "Cleaning",
    description: "Service path regression",
    amount: 50,
    amount_received: 0,
    outstanding_balance: 50,
    payment_status: "Pending",
    due_date: "2026-07-15",
    notes: "Automated service regression test",
  });

  if (serviceError) {
    throw new Error(`Service insert regression failed: ${serviceError.message}`);
  }

  console.log("\nPhase 3 external product sales verification passed.");
  console.log({
    product: product.product_name,
    stockBefore,
    stockAfter: productAfter.current_stock,
    sold: saleQuantity,
    incomeId,
    stockMovement: movement,
    cogsExpenseId: incomeRow.cogs_expense_id,
    serviceInvoice,
  });
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
