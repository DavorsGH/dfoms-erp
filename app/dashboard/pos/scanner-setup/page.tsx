import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserRole,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { canAccessCrmSection } from "@/utils/rbac-access";
import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "@/app/dashboard/inventory/finished-products-utils";
import {
  fetchScopedFinishedProductStock,
  mergeScopedStockOntoProducts,
  scopedFinishedProductsQuery,
} from "@/app/dashboard/inventory/finished-product-bu-stock-utils";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import CrmShell from "../../crm/crm-shell";
import ScannerSetupClient from "./scanner-setup-client";

export default async function ScannerSetupPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [role, tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserRole(),
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
  const showCrmNav = canAccessCrmSection(role as AppRole | null);

  if (!tenantId) {
    throw new Error("Unable to resolve workspace session for scanner setup.");
  }

  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const { data, error } = await scopedFinishedProductsQuery(
    supabase,
    buScope,
    FINISHED_PRODUCT_SELECT,
  );

  let products = ((data as FinishedProductRecord[] | null) ?? []).map((row) =>
    normalizeFinishedProduct(row),
  );

  const { stockMap, error: stockError } = await fetchScopedFinishedProductStock(
    supabase,
    tenantId,
    buScope,
  );

  if (!stockError) {
    products = mergeScopedStockOntoProducts(products, stockMap, buScope.mode);
  }

  const fetchError = error?.message ?? stockError ?? null;

  const body = (
    <>
      <p className="mb-6 text-sm text-slate-600">
        Test keyboard-wedge scanners before using them at POS checkout or in
        Inventory.
      </p>
      <ScannerSetupClient initialProducts={products} fetchError={fetchError} />
    </>
  );

  if (!showCrmNav) {
    return (
      <div>
        <h1 className="mb-2 text-2xl font-semibold text-[#0f2744]">
          Scanner Setup (POS Devices)
        </h1>
        {body}
      </div>
    );
  }

  return (
    <CrmShell sectionTitle="Scanner Setup (POS Devices)">{body}</CrmShell>
  );
}
