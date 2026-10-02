import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";
import { SUPPLIER_SELECT, type SupplierRow } from "@/utils/suppliers-types";

/** Active suppliers for the signed-in user's tenant, sorted by name. */
export async function fetchActiveTenantSuppliers(
  client: SupabaseClient,
): Promise<{ suppliers: SupplierRow[]; error: string | null }> {
  const { tenantId } = await resolveSessionTenantId(client);
  if (!tenantId) {
    return { suppliers: [], error: "Unable to resolve workspace." };
  }

  const { data, error } = await client
    .from("suppliers")
    .select(SUPPLIER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    return { suppliers: [], error: error.message };
  }

  return { suppliers: (data as SupplierRow[] | null) ?? [], error: null };
}
