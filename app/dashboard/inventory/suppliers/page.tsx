import { cookies } from "next/headers";
import { getCurrentUserRole, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canEditInventory } from "@/utils/rbac-access";
import {
  normalizeSupplier,
  SUPPLIER_SELECT,
  type SupplierRow,
} from "@/utils/suppliers-types";
import InventoryShell from "../inventory-shell";
import Suppliers from "../suppliers";

export default async function SuppliersPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <InventoryShell sectionTitle="Suppliers">
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </InventoryShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("suppliers")
    .select(SUPPLIER_SELECT)
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  const role = (await getCurrentUserRole()) as AppRole | null;

  return (
    <InventoryShell sectionTitle="Suppliers">
      <Suppliers
        initialSuppliers={
          ((data as SupplierRow[] | null) ?? []).map((row) =>
            normalizeSupplier(row),
          )
        }
        fetchError={error?.message ?? null}
        readOnly={!canEditInventory(role)}
      />
    </InventoryShell>
  );
}
