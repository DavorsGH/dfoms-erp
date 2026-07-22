import type { SupabaseClient } from "@supabase/supabase-js";

/** loan_register.loan_id */
export const LOAN_ENTITY_TYPE = "LOAN";
/** leave_management.leave_id */
export const LEAVE_ENTITY_TYPE = "LEAVE";

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
      error: "Unable to resolve workspace for HR ID allocation.",
    };
  }

  return { tenantId, error: null };
}

async function allocateHrCode(
  supabase: SupabaseClient,
  entityType: string,
  emptyError: string,
): Promise<{ code: string | null; error: string | null }> {
  const { tenantId, error: tenantError } = await resolveSessionTenantId(supabase);
  if (tenantError || !tenantId) {
    return { code: null, error: tenantError ?? "Missing tenant." };
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

/** loan_register.loan_id — generate_next_code(..., 'LOAN', 4). Create-save only. */
export async function allocateLoanId(
  supabase: SupabaseClient,
): Promise<{ loanId: string | null; error: string | null }> {
  const result = await allocateHrCode(
    supabase,
    LOAN_ENTITY_TYPE,
    "generate_next_code returned an empty loan ID.",
  );
  return { loanId: result.code, error: result.error };
}

/** leave_management.leave_id — generate_next_code(..., 'LEAVE', 4). Create-save only. */
export async function allocateLeaveId(
  supabase: SupabaseClient,
): Promise<{ leaveId: string | null; error: string | null }> {
  const result = await allocateHrCode(
    supabase,
    LEAVE_ENTITY_TYPE,
    "generate_next_code returned an empty leave ID.",
  );
  return { leaveId: result.code, error: result.error };
}
