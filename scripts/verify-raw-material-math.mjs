import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function assertClose(actual, expected, label) {
  const diff = Math.abs(Number(actual) - Number(expected));
  if (diff > 0.0001) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function cleanup(supabase, ids) {
  const { batchId, materialId, productId } = ids;
  if (batchId) {
    await supabase.from("production_batch_materials").delete().eq("batch_id", batchId);
    await supabase.from("stock_movements").delete().eq("reference_id", batchId);
    await supabase.from("production_batches").delete().eq("id", batchId);
  }
  if (materialId) {
    await supabase.from("raw_material_purchases").delete().eq("material_id", materialId);
    await supabase.from("raw_materials").delete().eq("id", materialId);
  }
  if (productId) {
    await supabase.from("finished_products").delete().eq("id", productId);
  }
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const suffix = Date.now();
  const materialCode = `RM-MATH-${suffix}`;
  const productCode = `FP-MATH-${suffix}`;
  const batchNumber = `BATCH-MATH-${suffix}`;

  const { data: material, error: materialError } = await supabase
    .from("raw_materials")
    .insert({
      material_code: materialCode,
      material_name: "Math Verify Material",
      unit_of_measure: "kg",
    })
    .select("id")
    .single();

  if (materialError) throw new Error(materialError.message);

  const purchaseQty = 100;
  const purchaseCost = 12.5;

  const { error: purchaseError } = await supabase.from("raw_material_purchases").insert({
    material_id: material.id,
    purchase_date: "2026-07-14",
    quantity: purchaseQty,
    cost_per_unit: purchaseCost,
    total_cost: purchaseQty * purchaseCost,
    supplier: "Math Verify Supplier",
    payment_method: "Cash",
    notes: "verify-raw-material-math purchase",
  });

  if (purchaseError) throw new Error(purchaseError.message);

  const { data: afterPurchase, error: afterPurchaseError } = await supabase
    .from("raw_materials")
    .select("current_stock, average_cost_per_unit")
    .eq("id", material.id)
    .single();

  if (afterPurchaseError) throw new Error(afterPurchaseError.message);
  assertClose(afterPurchase.current_stock, purchaseQty, "Stock after purchase");
  assertClose(
    afterPurchase.average_cost_per_unit,
    purchaseCost,
    "Average cost after purchase",
  );

  const { data: product, error: productError } = await supabase
    .from("finished_products")
    .insert({
      product_code: productCode,
      product_name: "Math Verify Product",
      unit_of_measure: "litres",
      standard_selling_price: 25,
    })
    .select("id")
    .single();

  if (productError) throw new Error(productError.message);

  const quantityUsed = 40;
  const quantityProduced = 80;

  const { data: batchId, error: batchError } = await supabase.rpc(
    "create_production_batch",
    {
      p_batch_number: batchNumber,
      p_production_date: "2026-07-14",
      p_finished_product_id: product.id,
      p_quantity_produced: quantityProduced,
      p_notes: "verify-raw-material-math batch",
      p_materials: [{ material_id: material.id, quantity_used: quantityUsed }],
    },
  );

  if (batchError) throw new Error(batchError.message);

  const { data: afterBatch, error: afterBatchError } = await supabase
    .from("raw_materials")
    .select("current_stock, average_cost_per_unit")
    .eq("id", material.id)
    .single();

  if (afterBatchError) throw new Error(afterBatchError.message);

  const expectedStock = purchaseQty - quantityUsed;
  assertClose(afterBatch.current_stock, expectedStock, "Stock after batch");
  assertClose(
    afterBatch.average_cost_per_unit,
    purchaseCost,
    "Average cost unchanged after consumption",
  );

  const { data: reconciled, error: reconcileError } = await supabase.rpc(
    "recalculate_raw_material_inventory",
    { p_material_id: material.id },
  );

  if (reconcileError) throw new Error(reconcileError.message);
  const row = Array.isArray(reconciled) ? reconciled[0] : reconciled;
  assertClose(row.current_stock, expectedStock, "Reconciled stock");
  assertClose(row.average_cost_per_unit, purchaseCost, "Reconciled average cost");

  await cleanup(supabase, {
    batchId,
    materialId: material.id,
    productId: product.id,
  });

  console.log("PASS: Raw material purchase + batch math verified.");
  console.log("PASS: recalculate_raw_material_inventory matches expected balances.");
}

main().catch((error) => {
  console.error(`\nVERIFY FAILED: ${error.message}`);
  process.exit(1);
});
