import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserRole,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canEditInventory } from "@/utils/rbac-access";
import InventoryShell from "../inventory-shell";
import BarcodeAssignment from "../barcode-assignment";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../finished-products-utils";
import {
  fetchScopedFinishedProductStock,
  mergeScopedStockOntoProducts,
  scopedFinishedProductsQuery,
} from "../finished-product-bu-stock-utils";

export default async function BarcodeAssignmentPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits, role, tenantId] =
    await Promise.all([
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
      getCurrentUserRole(),
      getCurrentUserTenantId(),
    ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const { data, error } = await scopedFinishedProductsQuery(
    supabase,
    buScope,
    FINISHED_PRODUCT_SELECT,
  ).order("product_name", { ascending: true });

  let products = ((data as FinishedProductRecord[] | null) ?? []).map((row) =>
    normalizeFinishedProduct(row),
  );

  if (tenantId) {
    const scopedStock = await fetchScopedFinishedProductStock(
      supabase,
      tenantId,
      buScope,
    );
    if (!scopedStock.error) {
      products = mergeScopedStockOntoProducts(
        products,
        scopedStock.stockMap,
        buScope.mode,
      );
    }
  }

  return (
    <InventoryShell sectionTitle="Barcode Assignment">
      <BarcodeAssignment
        initialProducts={products}
        readOnly={!canEditInventory(role as AppRole | null)}
        fetchError={error?.message ?? null}
      />
    </InventoryShell>
  );
}
