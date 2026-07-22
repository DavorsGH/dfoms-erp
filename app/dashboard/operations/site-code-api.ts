import type { SupabaseClient } from "@supabase/supabase-js";

/** Shared generate_next_code entity for sites.site_code. */
export const SITE_CODE_ENTITY_TYPE = "SITE";

async function resolveSessionTenantId(
  supabase: SupabaseClient,
): Promise<{ tenantId: string | null; error: string | null }> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return { tenantId: null, error: authError.message };
  }

  if (!user) {
    return { tenantId: null, error: "Not signed in." };
  }

  const { data, error } = await supabase
    .from("user_accounts")
    .select("tenant_id")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (error) {
    return { tenantId: null, error: error.message };
  }

  const tenantId =
    (data as { tenant_id?: string | null } | null)?.tenant_id ?? null;
  if (!tenantId) {
    return {
      tenantId: null,
      error: "Unable to resolve workspace for site code allocation.",
    };
  }

  return { tenantId, error: null };
}

/**
 * Allocates sites.site_code via generate_next_code(..., 'SITE', 4).
 * Call on create save only — do not use for edits of existing rows.
 */
export async function allocateSiteCode(
  supabase: SupabaseClient,
): Promise<{ siteCode: string | null; error: string | null }> {
  const { tenantId, error: tenantError } = await resolveSessionTenantId(supabase);
  if (tenantError || !tenantId) {
    return {
      siteCode: null,
      error: tenantError ?? "Missing tenant.",
    };
  }

  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: SITE_CODE_ENTITY_TYPE,
    p_padding: 4,
  });

  if (error) {
    return { siteCode: null, error: error.message };
  }

  const siteCode = typeof data === "string" ? data.trim() : "";
  if (!siteCode) {
    return {
      siteCode: null,
      error: "generate_next_code returned an empty site code.",
    };
  }

  return { siteCode, error: null };
}
