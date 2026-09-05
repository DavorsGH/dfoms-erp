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
import { SUPPLIER_SELECT, type SupplierRow } from "@/utils/suppliers-types";
import FinishedProducts from "../finished-products";
import {
  fetchFinishedProductLotDateSources,
  FINISHED_PRODUCT_SELECT,
  FINISHED_PRODUCT_STOCK_ADJUSTMENT_SELECT,
  mergeFinishedProductsWithLotDates,
  normalizeFinishedProduct,
  normalizeFinishedProductStockAdjustment,
  type FinishedProductRecord,
  type FinishedProductStockAdjustmentRecord,
} from "../finished-products-utils";
import {
  fetchScopedFinishedProductStock,
  mergeScopedStockOntoProducts,
} from "../finished-product-bu-stock-utils";
import InventoryShell from "../inventory-shell";

export default async function FinishedProductsPage() {
  const tenantId = await getCurrentUserTenantId();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const [
    { data, error },
    { data: suppliers, error: suppliersError },
    { data: adjustments, error: adjustmentsError },
    lotDatesResult,
    scopedStock,
  ] = await Promise.all([
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .order("product_name", { ascending: true }),
    tenantId
      ? supabase
          .from("suppliers")
          .select(SUPPLIER_SELECT)
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    tenantId
      ? applyBusinessUnitScope(
          supabase
            .from("finished_product_stock_adjustments")
            .select(FINISHED_PRODUCT_STOCK_ADJUSTMENT_SELECT)
            .eq("tenant_id", tenantId),
          buScope,
        ).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    fetchFinishedProductLotDateSources(supabase, buScope),
    tenantId
      ? fetchScopedFinishedProductStock(supabase, tenantId, buScope)
      : Promise.resolve({ stockMap: null, error: null }),
  ]);

  const role = (await getCurrentUserRole()) as AppRole | null;

  const catalogProducts = mergeFinishedProductsWithLotDates(
    ((data as FinishedProductRecord[] | null) ?? []).map((row) =>
      normalizeFinishedProduct(row),
    ),
    lotDatesResult.lots,
  );
  // Named BUs only see products with a balance row (stock list).
  // Adjustment picker keeps the full catalog via initialCatalogProducts.
  const displayProducts = mergeScopedStockOntoProducts(
    catalogProducts,
    scopedStock.stockMap,
    buScope.mode,
  );

  return (
    <InventoryShell sectionTitle="Finished Products">
      <FinishedProducts
        tenantId={tenantId}
        initialProducts={displayProducts}
        initialCatalogProducts={catalogProducts}
        initialAdjustments={
          (adjustments as FinishedProductStockAdjustmentRecord[] | null)?.map(
            (row) => normalizeFinishedProductStockAdjustment(row),
          ) ?? []
        }
        initialSuppliers={(suppliers as SupplierRow[] | null) ?? []}
        fetchError={
          error?.message ??
          suppliersError?.message ??
          adjustmentsError?.message ??
          lotDatesResult.error ??
          scopedStock.error ??
          null
        }
        readOnly={!canEditInventory(role)}
      />
    </InventoryShell>
  );
}
