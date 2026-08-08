import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMPLOYEE_ID_ENTITY_TYPE,
  STAFF_ID_ENTITY_TYPE,
  toPlainStaffId,
} from "@/app/dashboard/employees/employee-ids-api";

export const SIGNUP_OWNER_EMPLOYMENT_TYPE = "Full-Time";
export const SIGNUP_OWNER_POSITION = "Administrator";
export const SIGNUP_OWNER_EMPLOYMENT_STATUS = "Active";

export type SignupOwnerProvisioningInput = {
  tenantId: string;
  authUid: string;
  adminFullName: string;
  adminEmail: string;
  signupDate: string;
};

export type SignupOwnerProvisioningResult = {
  employeeId: string | null;
  staffId: string | null;
  error: string | null;
};

async function allocateCode(
  admin: SupabaseClient,
  tenantId: string,
  entityType: string,
): Promise<{ code: string | null; error: string | null }> {
  const { data, error } = await admin.rpc("generate_next_code", {
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

/**
 * Creates the signup owner's employee record, links user_accounts.employee_id,
 * and seeds expense/overtime + leave approver defaults for a new tenant.
 */
export async function provisionSignupOwnerEmployeeAndApprovers(
  admin: SupabaseClient,
  input: SignupOwnerProvisioningInput,
): Promise<SignupOwnerProvisioningResult> {
  const { tenantId, authUid, adminFullName, adminEmail, signupDate } = input;

  const { count, error: countError } = await admin
    .from("employees")
    .select("employee_id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (countError) {
    return { employeeId: null, staffId: null, error: countError.message };
  }

  if ((count ?? 0) > 0) {
    return {
      employeeId: null,
      staffId: null,
      error: "Tenant already has employee records; owner provisioning skipped.",
    };
  }

  const employeeResult = await allocateCode(
    admin,
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
    admin,
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

  const employeeId = employeeResult.code;
  const staffId = toPlainStaffId(staffResult.code);

  const { error: positionError } = await admin.from("positions").upsert(
    {
      tenant_id: tenantId,
      position_title: SIGNUP_OWNER_POSITION,
    },
    { onConflict: "tenant_id,position_title", ignoreDuplicates: true },
  );

  if (positionError) {
    return { employeeId: null, staffId: null, error: positionError.message };
  }

  const { error: employeeError } = await admin.from("employees").insert({
    tenant_id: tenantId,
    employee_id: employeeId,
    staff_id: staffId,
    full_name: adminFullName,
    email: adminEmail,
    employment_type: SIGNUP_OWNER_EMPLOYMENT_TYPE,
    employment_status: SIGNUP_OWNER_EMPLOYMENT_STATUS,
    position: SIGNUP_OWNER_POSITION,
    date_hired: signupDate,
  });

  if (employeeError) {
    return { employeeId: null, staffId: null, error: employeeError.message };
  }

  const { error: linkError } = await admin
    .from("user_accounts")
    .update({ employee_id: employeeId })
    .eq("auth_uid", authUid)
    .eq("tenant_id", tenantId);

  if (linkError) {
    return { employeeId, staffId, error: linkError.message };
  }

  const { error: approverError } = await admin.from("approvers").insert({
    tenant_id: tenantId,
    employee_id: employeeId,
  });

  if (approverError) {
    return { employeeId, staffId, error: approverError.message };
  }

  const { error: leaveApproverError } = await admin
    .from("leave_approver_config")
    .insert({
      tenant_id: tenantId,
      approver_user_account_id: authUid,
      effective_from: signupDate,
      notes: "Initial tenant owner",
    });

  if (leaveApproverError) {
    return { employeeId, staffId, error: leaveApproverError.message };
  }

  return { employeeId, staffId, error: null };
}
