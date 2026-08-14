import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Workspace display name for a tenant (tenants.name), with tenant_id fallback.
 */
export async function resolveTenantDisplayName(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    console.warn(
      `[tenant-display-name] lookup failed (${tenantId}): ${error.message}`,
    );
    return tenantId;
  }

  return data?.name?.trim() || tenantId;
}
