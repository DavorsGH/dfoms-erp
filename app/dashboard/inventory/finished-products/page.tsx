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
import { SUPPLIER_SELECT, type SupplierRow } from "@/utils/suppliers-types";
import FinishedProducts from "../finished-products";
import {
  fetchFinishedProductLotDateSources,
  FINISHED_PRODUCT_SELECT,
  mergeFinishedProductsWithLotDates,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../finished-products-utils";
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
    lotDatesResult,
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
    fetchFinishedProductLotDateSources(supabase, buScope),
  ]);

  const role = (await getCurrentUserRole()) as AppRole | null;

  const products = mergeFinishedProductsWithLotDates(
    ((data as FinishedProductRecord[] | null) ?? []).map((row) =>
      normalizeFinishedProduct(row),
    ),
    lotDatesResult.lots,
  );

  return (
    <InventoryShell sectionTitle="Finished Products">
      <FinishedProducts
        initialProducts={products}
        initialSuppliers={(suppliers as SupplierRow[] | null) ?? []}
        fetchError={
          error?.message ??
          suppliersError?.message ??
          lotDatesResult.error ??
          null
        }
        readOnly={!canEditInventory(role)}
      />
    </InventoryShell>
  );
}
