import type { SupabaseClient } from "@supabase/supabase-js";

/** Shared generate_next_code entity for customers.contract_number. */
export const CONTRACT_NUMBER_ENTITY_TYPE = "CONTRACT";

/** Shared generate_next_code entity for customers.client_id. */
export const CLIENT_ID_ENTITY_TYPE = "CLIENT";

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
      error: "Unable to resolve workspace for code allocation.",
    };
  }

  return { tenantId, error: null };
}

async function allocateCode(
  supabase: SupabaseClient,
  entityType: string,
  emptyError: string,
): Promise<{ code: string | null; error: string | null }> {
  const { tenantId, error: tenantError } = await resolveSessionTenantId(supabase);
  if (tenantError || !tenantId) {
    return {
      code: null,
      error: tenantError ?? "Missing tenant.",
    };
  }

  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: entityType,
    p_padding: 4,
  });

  if (error) {
    return { code: null, error: error.message };
  }

  const code = typeof data === "string" ? data.trim() : "";
  if (!code) {
    return { code: null, error: emptyError };
  }

  return { code, error: null };
}

/**
 * Allocates customers.contract_number via generate_next_code(..., 'CONTRACT', 4).
 * Call on create save only — do not use for edits of existing rows.
 */
export async function allocateContractNumber(
  supabase: SupabaseClient,
): Promise<{ contractNumber: string | null; error: string | null }> {
  const result = await allocateCode(
    supabase,
    CONTRACT_NUMBER_ENTITY_TYPE,
    "generate_next_code returned an empty contract number.",
  );
  return { contractNumber: result.code, error: result.error };
}

/**
 * Allocates customers.client_id via generate_next_code(..., 'CLIENT', 4).
 * Call on create save only — do not use for edits of existing rows.
 * (Signup ERP-suite billing customers under Davors still use CLI max+1.)
 */
export async function allocateClientId(
  supabase: SupabaseClient,
): Promise<{ clientId: string | null; error: string | null }> {
  const result = await allocateCode(
    supabase,
    CLIENT_ID_ENTITY_TYPE,
    "generate_next_code returned an empty client ID.",
  );
  return { clientId: result.code, error: result.error };
}
