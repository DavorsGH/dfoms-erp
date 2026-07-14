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

function isRawMaterialLowStock(material) {
  return (
    material.reorder_level != null &&
    Number(material.current_stock) <= Number(material.reorder_level)
  );
}

function resolveCogsAmount(cogs) {
  if (!cogs) return 0;
  if (Array.isArray(cogs)) return Number(cogs[0]?.amount) || 0;
  return Number(cogs.amount) || 0;
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const PRODUCT_SALES_REPORT_SELECT =
    "id, date, amount, sale_quantity, unit_price, cogs:expense_register!cogs_expense_id(amount)";
  const PRODUCTION_BATCH_DETAIL_SELECT =
    "id, batch_number, production_date, finished_product_id, quantity_produced, cost_per_unit_produced, total_batch_cost, product:finished_products!finished_product_id(product_name, unit_of_measure), materials:production_batch_materials(quantity_used, material:raw_materials!material_id(material_name, unit_of_measure))";

  const [
    { data: rawMaterials, error: rawMaterialsError },
    { data: finishedProducts, error: finishedProductsError },
    { data: batchSummaries, error: batchSummariesError },
    { data: batches, error: batchesError },
    { data: sales, error: salesError },
    { data: consumption, error: consumptionError },
  ] = await Promise.all([
    supabase
      .from("raw_materials")
      .select(
        "id, material_name, unit_of_measure, current_stock, average_cost_per_unit, reorder_level",
      ),
    supabase
      .from("finished_products")
      .select(
        "id, product_name, unit_of_measure, current_stock, standard_selling_price",
      ),
    supabase
      .from("production_batches")
      .select("finished_product_id, total_batch_cost, quantity_produced"),
    supabase.from("production_batches").select(PRODUCTION_BATCH_DETAIL_SELECT),
    supabase
      .from("income_register")
      .select(PRODUCT_SALES_REPORT_SELECT)
      .eq("entry_type", "product_sale"),
    supabase
      .from("internal_consumption")
      .select(
        "id, product_id, quantity, consumption_date, reason, recorded_by, product:finished_products!product_id(product_name, unit_of_measure)",
      ),
  ]);

  const errors = [
    rawMaterialsError,
    finishedProductsError,
    batchSummariesError,
    batchesError,
    salesError,
    consumptionError,
  ].filter(Boolean);

  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }

  if (!rawMaterials?.length) {
    throw new Error("Expected raw materials for Stock on Hand.");
  }
  if (!finishedProducts?.length) {
    throw new Error("Expected finished products for Stock on Hand.");
  }

  const rawMaterialsTotalValue = rawMaterials.reduce((sum, row) => {
    const stock = Number(row.current_stock) || 0;
    const cost = Number(row.average_cost_per_unit) || 0;
    return sum + stock * cost;
  }, 0);

  const averageCostByProduct = new Map();
  for (const batch of batchSummaries ?? []) {
    const existing = averageCostByProduct.get(batch.finished_product_id) ?? {
      cost: 0,
      quantity: 0,
    };
    existing.cost += Number(batch.total_batch_cost) || 0;
    existing.quantity += Number(batch.quantity_produced) || 0;
    averageCostByProduct.set(batch.finished_product_id, existing);
  }

  const finishedProductsTotalValue = finishedProducts.reduce((sum, product) => {
    const totals = averageCostByProduct.get(product.id);
    const avgCost =
      totals && totals.quantity > 0 ? totals.cost / totals.quantity : 0;
    return sum + (Number(product.current_stock) || 0) * avgCost;
  }, 0);

  const lowStockCount = rawMaterials.filter((row) => isRawMaterialLowStock(row)).length;

  if (!batches?.length) {
    throw new Error("Expected production batches in Production History.");
  }

  const batch = batches[0];
  const materials = Array.isArray(batch.materials) ? batch.materials : [];
  if (!materials.length) {
    throw new Error("Expected production batch materials consumed.");
  }

  if (!sales?.length) {
    throw new Error("Expected product sale rows.");
  }

  const sale = sales[0];
  const revenue = Number(sale.amount) || 0;
  const cogs = resolveCogsAmount(sale.cogs);
  const grossMargin = revenue - cogs;

  if (revenue <= 0) {
    throw new Error("Expected product sale revenue > 0.");
  }

  if (!consumption?.length) {
    throw new Error("Expected internal consumption rows.");
  }

  console.log("Phase 4 inventory reporting verification passed.");
  console.log({
    rawMaterialCount: rawMaterials.length,
    finishedProductCount: finishedProducts.length,
    rawMaterialsTotalValue: Math.round(rawMaterialsTotalValue * 100) / 100,
    finishedProductsTotalValue:
      Math.round(finishedProductsTotalValue * 100) / 100,
    lowStockCount,
    productionBatchCount: batches.length,
    sampleBatch: batch.batch_number,
    materialsConsumedCount: materials.length,
    productSalesCount: sales.length,
    sampleSaleRevenue: revenue,
    sampleSaleCogs: cogs,
    sampleSaleGrossMargin: Math.round(grossMargin * 100) / 100,
    internalConsumptionCount: consumption.length,
  });
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
