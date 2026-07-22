import type { SupabaseClient } from "@supabase/supabase-js";

export const WORK_ORDER_ENTITY_TYPE = "WO";
export const COMPLAINT_ENTITY_TYPE = "CMP";
export const CORRECTIVE_ACTION_ENTITY_TYPE = "CA";
export const FAILED_INSPECTION_ENTITY_TYPE = "ISS";
export const INCIDENT_ENTITY_TYPE = "INC";
export const CHECKLIST_ENTITY_TYPE = "CHECKLIST";

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
      error: "Unable to resolve workspace for operations ID allocation.",
    };
  }

  return { tenantId, error: null };
}

async function allocateOperationsCode(
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

/** work_orders.work_order_no — generate_next_code(..., 'WO', 4). Create-save only. */
export async function allocateWorkOrderNo(
  supabase: SupabaseClient,
): Promise<{ workOrderNo: string | null; error: string | null }> {
  const result = await allocateOperationsCode(
    supabase,
    WORK_ORDER_ENTITY_TYPE,
    "generate_next_code returned an empty work order number.",
  );
  return { workOrderNo: result.code, error: result.error };
}

/** complaint_register.complaint_no — generate_next_code(..., 'CMP', 4). Create-save only. */
export async function allocateComplaintNo(
  supabase: SupabaseClient,
): Promise<{ complaintNo: string | null; error: string | null }> {
  const result = await allocateOperationsCode(
    supabase,
    COMPLAINT_ENTITY_TYPE,
    "generate_next_code returned an empty complaint number.",
  );
  return { complaintNo: result.code, error: result.error };
}

/** corrective_actions.action_no — generate_next_code(..., 'CA', 4). Create-save only. */
export async function allocateCorrectiveActionNo(
  supabase: SupabaseClient,
): Promise<{ actionNo: string | null; error: string | null }> {
  const result = await allocateOperationsCode(
    supabase,
    CORRECTIVE_ACTION_ENTITY_TYPE,
    "generate_next_code returned an empty corrective action number.",
  );
  return { actionNo: result.code, error: result.error };
}

/** failed_inspections.issue_no — generate_next_code(..., 'ISS', 4). Create-save only. */
export async function allocateFailedInspectionIssueNo(
  supabase: SupabaseClient,
): Promise<{ issueNo: string | null; error: string | null }> {
  const result = await allocateOperationsCode(
    supabase,
    FAILED_INSPECTION_ENTITY_TYPE,
    "generate_next_code returned an empty issue number.",
  );
  return { issueNo: result.code, error: result.error };
}

/** incident_register.incident_no — generate_next_code(..., 'INC', 4). Create-save only. */
export async function allocateIncidentNo(
  supabase: SupabaseClient,
): Promise<{ incidentNo: string | null; error: string | null }> {
  const result = await allocateOperationsCode(
    supabase,
    INCIDENT_ENTITY_TYPE,
    "generate_next_code returned an empty incident number.",
  );
  return { incidentNo: result.code, error: result.error };
}

/** inspection_summary.checklist_id — generate_next_code(..., 'CHECKLIST', 4). Create-save only. */
export async function allocateChecklistId(
  supabase: SupabaseClient,
): Promise<{ checklistId: string | null; error: string | null }> {
  const result = await allocateOperationsCode(
    supabase,
    CHECKLIST_ENTITY_TYPE,
    "generate_next_code returned an empty checklist ID.",
  );
  return { checklistId: result.code, error: result.error };
}
