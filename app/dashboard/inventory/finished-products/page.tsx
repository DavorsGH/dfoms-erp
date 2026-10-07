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
  scopedFinishedProductsQuery,
} from "../finished-product-bu-stock-utils";
import InventoryShell from "../inventory-shell";
import { CONTRACT_PROJECT_SELECT } from "../../administration/projects-utils";
import {
  SITE_ASSIGNMENT_SELECT,
  normalizeSiteEntry,
  type SiteEntry,
} from "../../operations/sites-utils";
import { getInventoryRecordedByLabel } from "../get-inventory-recorded-by-label";
import {
  INTERNAL_CONSUMPTION_SELECT,
  normalizeInternalConsumption,
  type InternalConsumptionRecord,
} from "../internal-consumption-utils";

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
    internalConsumptionResult,
    icProductsResult,
    icProjectsResult,
    icSitesResult,
    recordedByLabel,
  ] = await Promise.all([
    scopedFinishedProductsQuery(supabase, buScope, FINISHED_PRODUCT_SELECT).order(
      "product_name",
      { ascending: true },
    ),
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
    tenantId
      ? applyBusinessUnitScope(
          supabase
            .from("internal_consumption")
            .select(INTERNAL_CONSUMPTION_SELECT)
            .eq("tenant_id", tenantId),
          buScope,
        )
          .order("consumption_date", { ascending: false })
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    scopedFinishedProductsQuery(supabase, buScope, FINISHED_PRODUCT_SELECT)
      .eq("is_archived", false)
      .order("product_name", { ascending: true }),
    tenantId
      ? applyBusinessUnitScope(
          supabase
            .from("projects")
            .select(CONTRACT_PROJECT_SELECT)
            .eq("is_archived", false),
          buScope,
        ).order("project_name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("sites")
      .select(SITE_ASSIGNMENT_SELECT)
      .order("site_name", { ascending: true }),
    getInventoryRecordedByLabel(supabase),
  ]);

  const role = (await getCurrentUserRole()) as AppRole | null;

  const catalogProducts = mergeFinishedProductsWithLotDates(
    ((data as FinishedProductRecord[] | null) ?? []).map((row) =>
      normalizeFinishedProduct(row),
    ),
    lotDatesResult.lots,
  );
  // Scoped catalog rows; stock overlay still applies per active BU.
  const displayProducts = mergeScopedStockOntoProducts(
    catalogProducts,
    scopedStock.stockMap,
    buScope.mode,
  );

  const icProducts = mergeScopedStockOntoProducts(
    ((icProductsResult.data as FinishedProductRecord[] | null) ?? []).map(
      (row) => normalizeFinishedProduct(row),
    ),
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
          internalConsumptionResult.error?.message ??
          icProductsResult.error?.message ??
          icProjectsResult.error?.message ??
          icSitesResult.error?.message ??
          null
        }
        readOnly={!canEditInventory(role)}
        initialInternalConsumptionEntries={
          (
            (internalConsumptionResult.data as InternalConsumptionRecord[] | null) ??
            []
          ).map((row) => normalizeInternalConsumption(row))
        }
        initialInternalConsumptionProducts={icProducts}
        initialInternalConsumptionProjects={icProjectsResult.data ?? []}
        initialInternalConsumptionSites={(icSitesResult.data ?? []).map((row) =>
          normalizeSiteEntry(row as unknown as SiteEntry),
        )}
        internalConsumptionRecordedByLabel={recordedByLabel}
      />
    </InventoryShell>
  );
}
