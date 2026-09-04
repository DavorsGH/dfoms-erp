import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserRole,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canEditInventory } from "@/utils/rbac-access";
import InventoryShell from "../inventory-shell";
import ProductionBatches from "../production-batches";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../finished-products-utils";
import {
  fetchScopedFinishedProductStock,
  mergeScopedStockOntoProducts,
} from "../finished-product-bu-stock-utils";
import {
  normalizeProductionBatch,
  PRODUCTION_BATCH_DETAIL_SELECT,
  type ProductionBatchRecord,
} from "../production-batches-utils";
import {
  normalizeRawMaterial,
  RAW_MATERIAL_SELECT,
  type RawMaterialRecord,
} from "../raw-materials-utils";
import {
  fetchScopedRawMaterialStock,
  mergeScopedStockOntoMaterials,
} from "../raw-material-bu-stock-utils";

export default async function ProductionBatchesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits, tenantId] =
    await Promise.all([
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
      getCurrentUserTenantId(),
    ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  if (!tenantId) {
    throw new Error(
      "Unable to resolve workspace session for Production Batches.",
    );
  }

  const [
    { data: batches, error: batchesError },
    { data: products, error: productsError },
    { data: materials, error: materialsError },
  ] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("production_batches")
        .select(PRODUCTION_BATCH_DETAIL_SELECT),
      buScope,
    ).order("production_date", { ascending: false }),
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .eq("is_archived", false)
      .order("product_name", { ascending: true }),
    supabase
      .from("raw_materials")
      .select(RAW_MATERIAL_SELECT)
      .order("material_name", { ascending: true }),
  ]);

  const [
    { stockMap: productStockMap, error: productStockScopeError },
    { stockMap: materialStockMap, error: materialStockScopeError },
  ] = await Promise.all([
    fetchScopedFinishedProductStock(supabase, tenantId, buScope),
    fetchScopedRawMaterialStock(supabase, tenantId, buScope),
  ]);

  const initialProducts = mergeScopedStockOntoProducts(
    (products as FinishedProductRecord[] | null)?.map((row) =>
      normalizeFinishedProduct(row),
    ) ?? [],
    productStockMap,
  );
  const initialMaterials = mergeScopedStockOntoMaterials(
    (materials as RawMaterialRecord[] | null)?.map((row) =>
      normalizeRawMaterial(row),
    ) ?? [],
    materialStockMap,
  );

  const fetchError =
    batchesError?.message ??
    productsError?.message ??
    materialsError?.message ??
    productStockScopeError ??
    materialStockScopeError ??
    null;

  const role = (await getCurrentUserRole()) as AppRole | null;

  return (
    <InventoryShell sectionTitle="Production Batches">
      <ProductionBatches
        initialBatches={
          (batches as ProductionBatchRecord[] | null)?.map((row) =>
            normalizeProductionBatch(row),
          ) ?? []
        }
        initialProducts={initialProducts}
        initialMaterials={initialMaterials}
        fetchError={fetchError}
        readOnly={!canEditInventory(role)}
        activeBusinessUnitId={activeBusinessUnitId}
        tenantId={tenantId}
      />
    </InventoryShell>
  );
}
