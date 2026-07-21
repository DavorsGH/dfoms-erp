import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserRole, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canEditInventory } from "@/utils/rbac-access";
import { SUPPLIER_SELECT, type SupplierRow } from "@/utils/suppliers-types";
import FinishedProducts from "../finished-products";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../finished-products-utils";
import InventoryShell from "../inventory-shell";

export default async function FinishedProductsPage() {
  const tenantId = await getCurrentUserTenantId();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data, error },
    { data: suppliers, error: suppliersError },
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
  ]);

  const role = (await getCurrentUserRole()) as AppRole | null;

  return (
    <InventoryShell sectionTitle="Finished Products">
      <FinishedProducts
        initialProducts={
          (data as FinishedProductRecord[] | null)?.map((row) =>
            normalizeFinishedProduct(row),
          ) ?? []
        }
        initialSuppliers={(suppliers as SupplierRow[] | null) ?? []}
        fetchError={error?.message ?? suppliersError?.message ?? null}
        readOnly={!canEditInventory(role)}
      />
    </InventoryShell>
  );
}
