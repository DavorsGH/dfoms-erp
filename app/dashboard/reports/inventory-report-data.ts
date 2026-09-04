import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";
import type { InternalConsumptionRecord } from "../inventory/internal-consumption-utils";
import {
  INTERNAL_CONSUMPTION_SELECT,
  normalizeInternalConsumption,
} from "../inventory/internal-consumption-utils";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
} from "../inventory/finished-products-utils";
import {
  fetchScopedFinishedProductStock,
  mergeScopedStockOntoProducts,
} from "../inventory/finished-product-bu-stock-utils";
import type { FinishedProductAverageCostRow } from "../inventory/inventory-balance-sheet-utils";
import type { ProductionBatchRecord } from "../inventory/production-batches-utils";
import {
  PRODUCTION_BATCH_DETAIL_SELECT,
  normalizeProductionBatch,
} from "../inventory/production-batches-utils";
import {
  RAW_MATERIAL_SELECT,
  normalizeRawMaterial,
} from "../inventory/raw-materials-utils";
import {
  fetchScopedRawMaterialStock,
  mergeScopedStockOntoMaterials,
} from "../inventory/raw-material-bu-stock-utils";
import { CLIENT_SELECT } from "../operations/clients-utils";
import { SITE_ASSIGNMENT_SELECT } from "../operations/sites-utils";
import {
  countLowStockRawMaterials,
  type ProductSaleReportRecord,
} from "./inventory-reports-utils";

export const PRODUCT_SALES_REPORT_SELECT =
  "id, date, invoice_no, client_id, customer_name, amount, sale_quantity, unit_price, product_id, cogs_expense_id, sale_status, client:customers!income_register_client_id_fkey(client_id, client_name), product:finished_products!product_id(product_code, product_name, unit_of_measure), cogs:expense_register!cogs_expense_id(amount)";

export async function fetchLowStockRawMaterialCount(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("raw_materials")
    .select("current_stock, reorder_level");

  if (error) {
    return { count: 0, error: error.message };
  }

  return {
    count: countLowStockRawMaterials(data ?? []),
    error: null as string | null,
  };
}

export async function fetchStockOnHandReportData(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope = { mode: "all" },
) {
  const [
    { data: rawMaterials, error: rawMaterialsError },
    { data: finishedProducts, error: finishedProductsError },
    { data: averageCostRows, error: averageCostsError },
    { stockMap: rawMaterialStockMap, error: rawMaterialStockError },
    { stockMap: finishedProductStockMap, error: finishedProductStockError },
  ] = await Promise.all([
    supabase
      .from("raw_materials")
      .select(RAW_MATERIAL_SELECT)
      .order("material_name", { ascending: true }),
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .order("product_name", { ascending: true }),
    // Combined production_batches + product_purchases weighted average cost.
    supabase.rpc("get_finished_product_average_costs", {
      p_tenant_id: tenantId,
    }),
    fetchScopedRawMaterialStock(supabase, tenantId, buScope),
    fetchScopedFinishedProductStock(supabase, tenantId, buScope),
  ]);

  const normalizedRawMaterials = mergeScopedStockOntoMaterials(
    (rawMaterials ?? []).map((row) => normalizeRawMaterial(row)),
    rawMaterialStockMap,
  );
  const normalizedFinishedProducts = mergeScopedStockOntoProducts(
    (finishedProducts ?? []).map((row) => normalizeFinishedProduct(row)),
    finishedProductStockMap,
  );

  const fetchError =
    rawMaterialsError?.message ??
    finishedProductsError?.message ??
    averageCostsError?.message ??
    rawMaterialStockError ??
    finishedProductStockError ??
    null;

  return {
    initialRawMaterials: normalizedRawMaterials,
    initialFinishedProducts: normalizedFinishedProducts,
    initialAverageCosts: (
      (averageCostRows as FinishedProductAverageCostRow[] | null) ?? []
    ).map((row) => ({
      product_id: row.product_id,
      average_cost: Number(row.average_cost) || 0,
    })),
    lowStockRawMaterialCount: countLowStockRawMaterials(normalizedRawMaterials),
    fetchError,
  };
}

export async function fetchProductionHistoryReportData(
  supabase: SupabaseClient,
) {
  const [{ data: batches, error: batchesError }, { data: products, error: productsError }] =
    await Promise.all([
      supabase
        .from("production_batches")
        .select(PRODUCTION_BATCH_DETAIL_SELECT)
        .order("production_date", { ascending: false }),
      supabase
        .from("finished_products")
        .select("id, product_name")
        .order("product_name", { ascending: true }),
    ]);

  return {
    initialBatches:
      ((batches as ProductionBatchRecord[] | null) ?? []).map((batch) =>
        normalizeProductionBatch(batch),
      ) ?? [],
    productOptions: products ?? [],
    fetchError: batchesError?.message ?? productsError?.message ?? null,
  };
}

export async function fetchProductSalesReportData(supabase: SupabaseClient) {
  const [
    { data: sales, error: salesError },
    { data: clients, error: clientsError },
    { data: products, error: productsError },
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select(PRODUCT_SALES_REPORT_SELECT)
      .eq("entry_type", "product_sale")
      .order("date", { ascending: false }),
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", { ascending: true }),
    supabase
      .from("finished_products")
      .select("id, product_name")
      .order("product_name", { ascending: true }),
  ]);

  return {
    initialSales: (sales as ProductSaleReportRecord[] | null) ?? [],
    clientOptions: clients ?? [],
    productOptions: products ?? [],
    fetchError:
      salesError?.message ?? clientsError?.message ?? productsError?.message ?? null,
  };
}

export async function fetchInternalConsumptionReportData(
  supabase: SupabaseClient,
) {
  const [
    { data: entries, error: entriesError },
    { data: products, error: productsError },
    { data: clients, error: clientsError },
    { data: sites, error: sitesError },
  ] = await Promise.all([
    supabase
      .from("internal_consumption")
      .select(INTERNAL_CONSUMPTION_SELECT)
      .order("consumption_date", { ascending: false }),
    supabase
      .from("finished_products")
      .select("id, product_name")
      .order("product_name", { ascending: true }),
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", { ascending: true }),
    supabase
      .from("sites")
      .select(SITE_ASSIGNMENT_SELECT)
      .order("site_name", { ascending: true }),
  ]);

  return {
    initialEntries:
      ((entries as InternalConsumptionRecord[] | null) ?? []).map((entry) =>
        normalizeInternalConsumption(entry),
      ) ?? [],
    productOptions: products ?? [],
    clientOptions: clients ?? [],
    siteOptions: sites ?? [],
    fetchError:
      entriesError?.message ??
      productsError?.message ??
      clientsError?.message ??
      sitesError?.message ??
      null,
  };
}
