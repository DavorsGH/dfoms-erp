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
    { count: expenseCount, error: expenseCountError },
    { data: expenseSumRows, error: expenseSumError },
    { count: incomeCount, error: incomeCountError },
    { data: incomeSumRows, error: incomeSumError },
    { count: assetCount, error: assetCountError },
    { data: assetSumRows, error: assetSumError },
    { count: manualCount, error: manualCountError },
  ] = await Promise.all([
    supabase.from("expense_register").select("*", { count: "exact", head: true }),
    supabase.from("expense_register").select("amount"),
    supabase.from("income_register").select("*", { count: "exact", head: true }),
    supabase.from("income_register").select("amount"),
    supabase.from("fixed_assets").select("*", { count: "exact", head: true }),
    supabase.from("fixed_assets").select("original_cost, quantity"),
    supabase
      .from("manual_financial_entries")
      .select("*", { count: "exact", head: true }),
  ]);

  const errors = [
    expenseCountError,
    expenseSumError,
    incomeCountError,
    incomeSumError,
    assetCountError,
    assetSumError,
    manualCountError,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors[0].message);
  }

  const expenseTotal = (expenseSumRows ?? []).reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0,
  );
  const incomeTotal = (incomeSumRows ?? []).reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0,
  );
  const assetTotal = (assetSumRows ?? []).reduce(
    (sum, row) => sum + Number(row.original_cost || 0) * Number(row.quantity || 0),
    0,
  );

  return {
    expenseCount: expenseCount ?? 0,
    expenseTotal,
    incomeCount: incomeCount ?? 0,
    incomeTotal,
    assetCount: assetCount ?? 0,
    assetTotal,
    manualCount: manualCount ?? 0,
  };
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: schemaCheck, error: schemaError } = await supabase
    .from("raw_materials")
    .select("id")
    .limit(1);

  if (schemaError) {
    throw new Error(
      `Inventory tables not available (${schemaError.message}). Run scripts/38_sales_inventory_foundation.sql first.`,
    );
  }

  const financeBefore = await snapshotFinance(supabase);
  console.log("Finance snapshot (before):", financeBefore);

  const testSuffix = Date.now();
  const materialCode = `RM-TEST-${testSuffix}`;
  const productCode = `FP-TEST-${testSuffix}`;
  const batchNumber = `BATCH-TEST-${testSuffix}`;

  const { data: material, error: materialError } = await supabase
    .from("raw_materials")
    .insert({
      material_code: materialCode,
      material_name: "Phase 1 Test Surfactant",
      unit_of_measure: "litres",
    })
    .select("id, current_stock, average_cost_per_unit")
    .single();

  if (materialError) {
    throw new Error(materialError.message);
  }

  const purchaseQuantity = 100;
  const purchaseUnitCost = 12.5;

  const { error: purchaseError } = await supabase
    .from("raw_material_purchases")
    .insert({
      material_id: material.id,
      purchase_date: "2026-07-14",
      quantity: purchaseQuantity,
      cost_per_unit: purchaseUnitCost,
      total_cost: purchaseQuantity * purchaseUnitCost,
      supplier: "Phase 1 Test Supplier",
    });

  if (purchaseError) {
    throw new Error(purchaseError.message);
  }

  const { data: materialAfterPurchase, error: materialAfterPurchaseError } =
    await supabase
      .from("raw_materials")
      .select("current_stock, average_cost_per_unit")
      .eq("id", material.id)
      .single();

  if (materialAfterPurchaseError) {
    throw new Error(materialAfterPurchaseError.message);
  }

  assertClose(
    materialAfterPurchase.current_stock,
    purchaseQuantity,
    "Raw material stock after purchase",
  );
  assertClose(
    materialAfterPurchase.average_cost_per_unit,
    purchaseUnitCost,
    "Raw material average cost after purchase",
  );

  const { data: product, error: productError } = await supabase
    .from("finished_products")
    .insert({
      product_code: productCode,
      product_name: "Phase 1 Test Detergent",
      unit_of_measure: "litres",
      standard_selling_price: 25,
    })
    .select("id, current_stock")
    .single();

  if (productError) {
    throw new Error(productError.message);
  }

  const quantityUsed = 40;
  const quantityProduced = 80;
  const expectedBatchCost = quantityUsed * purchaseUnitCost;
  const expectedUnitCost = expectedBatchCost / quantityProduced;

  const { data: batchId, error: batchError } = await supabase.rpc(
    "create_production_batch",
    {
      p_batch_number: batchNumber,
      p_production_date: "2026-07-14",
      p_finished_product_id: product.id,
      p_quantity_produced: quantityProduced,
      p_notes: "Phase 1 verification batch",
      p_materials: [
        {
          material_id: material.id,
          quantity_used: quantityUsed,
        },
      ],
    },
  );

  if (batchError) {
    throw new Error(batchError.message);
  }

  const [
    { data: materialAfterBatch, error: materialAfterBatchError },
    { data: productAfterBatch, error: productAfterBatchError },
    { data: batch, error: batchRowError },
    { data: movements, error: movementsError },
  ] = await Promise.all([
    supabase
      .from("raw_materials")
      .select("current_stock, average_cost_per_unit")
      .eq("id", material.id)
      .single(),
    supabase
      .from("finished_products")
      .select("current_stock")
      .eq("id", product.id)
      .single(),
    supabase
      .from("production_batches")
      .select(
        "id, total_batch_cost, cost_per_unit_produced, quantity_produced",
      )
      .eq("id", batchId)
      .single(),
    supabase
      .from("stock_movements")
      .select("movement_type, quantity, reference_id, product_id")
      .eq("reference_id", batchId),
  ]);

  const rowErrors = [
    materialAfterBatchError,
    productAfterBatchError,
    batchRowError,
    movementsError,
  ].filter(Boolean);

  if (rowErrors.length > 0) {
    throw new Error(rowErrors[0].message);
  }

  assertClose(
    materialAfterBatch.current_stock,
    purchaseQuantity - quantityUsed,
    "Raw material stock after batch",
  );
  assertClose(
    productAfterBatch.current_stock,
    quantityProduced,
    "Finished product stock after batch",
  );
  assertClose(
    batch.total_batch_cost,
    expectedBatchCost,
    "Total batch cost",
  );
  assertClose(
    batch.cost_per_unit_produced,
    expectedUnitCost,
    "Cost per unit produced",
  );

  if (!movements?.length) {
    throw new Error("Expected a stock_movements row for the production batch.");
  }

  const movement = movements[0];
  if (movement.movement_type !== "production_in") {
    throw new Error(
      `Expected movement_type production_in, got ${movement.movement_type}`,
    );
  }

  assertClose(movement.quantity, quantityProduced, "Stock movement quantity");

  const financeAfter = await snapshotFinance(supabase);
  console.log("Finance snapshot (after):", financeAfter);

  const financeUnchanged =
    financeBefore.expenseCount === financeAfter.expenseCount &&
    financeBefore.incomeCount === financeAfter.incomeCount &&
    financeBefore.assetCount === financeAfter.assetCount &&
    financeBefore.manualCount === financeAfter.manualCount &&
    Math.abs(financeBefore.expenseTotal - financeAfter.expenseTotal) < 0.01 &&
    Math.abs(financeBefore.incomeTotal - financeAfter.incomeTotal) < 0.01 &&
    Math.abs(financeBefore.assetTotal - financeAfter.assetTotal) < 0.01;

  if (!financeUnchanged) {
    throw new Error("Finance/Balance Sheet source tables changed during inventory test.");
  }

  console.log("\nPhase 1 inventory verification passed.");
  console.log({
    materialCode,
    productCode,
    batchNumber,
    batchId,
    rawStockAfterBatch: materialAfterBatch.current_stock,
    finishedStockAfterBatch: productAfterBatch.current_stock,
    totalBatchCost: batch.total_batch_cost,
    costPerUnitProduced: batch.cost_per_unit_produced,
    stockMovement: movement,
  });
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
