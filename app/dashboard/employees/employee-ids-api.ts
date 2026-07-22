import type { SupabaseClient } from "@supabase/supabase-js";

export const EMPLOYEE_ID_ENTITY_TYPE = "EMP";
export const STAFF_ID_ENTITY_TYPE = "STAFF";

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

  const tenantId = (data as { tenant_id?: string | null } | null)?.tenant_id ?? null;
  if (!tenantId) {
    return {
      tenantId: null,
      error: "Unable to resolve workspace for employee ID allocation.",
    };
  }

  return { tenantId, error: null };
}

async function allocateCode(
  supabase: SupabaseClient,
  tenantId: string,
  entityType: string,
): Promise<{ code: string | null; error: string | null }> {
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
    return {
      code: null,
      error: `generate_next_code returned an empty ${entityType} code.`,
    };
  }

  return { code, error: null };
}

/** Allocates employee_id (EMP) and staff_id (STAFF) for a new employee create. */
export async function allocateNewEmployeeCodes(
  supabase: SupabaseClient,
): Promise<{
  employeeId: string | null;
  staffId: string | null;
  error: string | null;
}> {
  const { tenantId, error: tenantError } = await resolveSessionTenantId(supabase);
  if (tenantError || !tenantId) {
    return {
      employeeId: null,
      staffId: null,
      error: tenantError ?? "Missing tenant.",
    };
  }

  const employeeResult = await allocateCode(
    supabase,
    tenantId,
    EMPLOYEE_ID_ENTITY_TYPE,
  );
  if (employeeResult.error || !employeeResult.code) {
    return {
      employeeId: null,
      staffId: null,
      error: employeeResult.error ?? "Unable to allocate employee_id.",
    };
  }

  const staffResult = await allocateCode(
    supabase,
    tenantId,
    STAFF_ID_ENTITY_TYPE,
  );
  if (staffResult.error || !staffResult.code) {
    return {
      employeeId: employeeResult.code,
      staffId: null,
      error: staffResult.error ?? "Unable to allocate staff_id.",
    };
  }

  return {
    employeeId: employeeResult.code,
    staffId: staffResult.code,
    error: null,
  };
}
