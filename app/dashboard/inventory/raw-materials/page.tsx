import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserRole,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope, applyBusinessUnitScope } from "@/utils/business-unit-view";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canEditInventory } from "@/utils/rbac-access";
import {
  CONTRACT_PROJECT_SELECT,
  type ContractProjectOption,
} from "../../administration/projects-utils";
import InventoryShell from "../inventory-shell";
import RawMaterials from "../raw-materials";
import {
  normalizeRawMaterial,
  normalizeRawMaterialPurchase,
  normalizeRawMaterialStockAdjustment,
  RAW_MATERIAL_PURCHASE_SELECT,
  RAW_MATERIAL_SELECT,
  RAW_MATERIAL_STOCK_ADJUSTMENT_SELECT,
  type RawMaterialPurchaseRecord,
  type RawMaterialRecord,
  type RawMaterialStockAdjustmentRecord,
} from "../raw-materials-utils";
import {
  fetchScopedRawMaterialStock,
  mergeScopedStockOntoMaterials,
} from "../raw-material-bu-stock-utils";
import type { NamedLookup } from "../../lookup-types";

export default async function RawMaterialsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const [
    { data: materials, error: materialsError },
    { data: purchases, error: purchasesError },
    { data: adjustments, error: adjustmentsError },
    { data: paymentMethods, error: paymentMethodsError },
    { data: projects, error: projectsError },
    scopedStock,
  ] = await Promise.all([
    supabase
      .from("raw_materials")
      .select(RAW_MATERIAL_SELECT)
      .order("material_name", { ascending: true }),
    applyBusinessUnitScope(
      supabase
        .from("raw_material_purchases")
        .select(RAW_MATERIAL_PURCHASE_SELECT),
      buScope,
    ).order("purchase_date", { ascending: false }),
    applyBusinessUnitScope(
      supabase
        .from("raw_material_stock_adjustments")
        .select(RAW_MATERIAL_STOCK_ADJUSTMENT_SELECT),
      buScope,
    ).order("created_at", { ascending: false }),
    supabase
      .from("payment_methods")
      .select("name")
      .order("name", { ascending: true }),
    tenantId
      ? supabase
          .from("projects")
          .select(CONTRACT_PROJECT_SELECT)
          .eq("tenant_id", tenantId)
          .order("project_name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    tenantId
      ? fetchScopedRawMaterialStock(supabase, tenantId, buScope)
      : Promise.resolve({ stockMap: null, error: null }),
  ]);

  const catalogMaterials =
    (materials as RawMaterialRecord[] | null)?.map((row) =>
      normalizeRawMaterial(row),
    ) ?? [];
  // Stock-on-hand list: named BUs only see materials with a balance row.
  // Purchase picker keeps the full catalog via initialCatalogMaterials.
  const displayMaterials = mergeScopedStockOntoMaterials(
    catalogMaterials,
    scopedStock.stockMap,
    buScope.mode,
    { overlayAverageCost: true },
  );

  const role = (await getCurrentUserRole()) as AppRole | null;

  return (
    <InventoryShell sectionTitle="Raw Materials">
      <RawMaterials
        tenantId={tenantId}
        initialMaterials={displayMaterials}
        initialCatalogMaterials={catalogMaterials}
        initialPurchases={
          (purchases as RawMaterialPurchaseRecord[] | null)?.map((row) =>
            normalizeRawMaterialPurchase(row),
          ) ?? []
        }
        initialAdjustments={
          (adjustments as RawMaterialStockAdjustmentRecord[] | null)?.map(
            (row) => normalizeRawMaterialStockAdjustment(row),
          ) ?? []
        }
        initialPaymentMethods={(paymentMethods as NamedLookup[] | null) ?? []}
        initialProjects={(projects as ContractProjectOption[] | null) ?? []}
        fetchError={
          materialsError?.message ??
          purchasesError?.message ??
          adjustmentsError?.message ??
          paymentMethodsError?.message ??
          projectsError?.message ??
          scopedStock.error ??
          null
        }
        readOnly={!canEditInventory(role)}
        activeBusinessUnitId={activeBusinessUnitId}
      />
    </InventoryShell>
  );
}
