import type { SupabaseClient } from "@supabase/supabase-js";
import {
  roleRequiresClient,
  roleRequiresEmployee,
  roleRequiresSupervisorSites,
  roleShowsEmployeePicker,
  validateRoleAssignment,
} from "@/app/dashboard/user-account-role-utils";
import type { AppRole } from "@/app/dashboard/user-account-types";

type AdminClient = SupabaseClient;

export type PersistUserRoleInput = {
  tenant_id: string;
  role: string;
  employee_id?: string | null;
  client_id?: string | null;
  supervisor_site_codes?: string[];
};

export async function syncSupervisorSites(
  admin: AdminClient,
  authUid: string,
  role: AppRole,
  siteCodes: string[],
  tenantId: string,
) {
  await admin
    .from("user_account_supervisor_sites")
    .delete()
    .eq("auth_uid", authUid)
    .eq("tenant_id", tenantId);

  if (!roleRequiresSupervisorSites(role) || siteCodes.length === 0) {
    return null;
  }

  const { error } = await admin.from("user_account_supervisor_sites").insert(
    siteCodes.map((site_code) => ({
      auth_uid: authUid,
      site_code,
      tenant_id: tenantId,
    })),
  );

  return error?.message ?? null;
}

export function buildUserAccountPayload(input: PersistUserRoleInput) {
  const validationErrors = validateRoleAssignment(input);
  if (Object.keys(validationErrors).length > 0) {
    return { ok: false as const, errors: validationErrors };
  }

  const role = input.role as AppRole;
  const employeeId = input.employee_id?.trim() || null;
  const clientId = input.client_id?.trim() || null;

  return {
    ok: true as const,
    payload: {
      tenant_id: input.tenant_id,
      role,
      employee_id: roleShowsEmployeePicker(role) ? employeeId : null,
      client_id: roleRequiresClient(role) ? clientId : null,
    },
    supervisor_site_codes: roleRequiresSupervisorSites(role)
      ? (input.supervisor_site_codes ?? []).filter(Boolean)
      : [],
  };
}

export async function ensureEmployeeAvailable(
  admin: AdminClient,
  employeeId: string,
  tenantId: string,
  excludeAuthUid?: string,
) {
  const { data: employee } = await admin
    .from("employees")
    .select("employee_id")
    .eq("employee_id", employeeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!employee) {
    return "Employee not found in your workspace";
  }

  let query = admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("employee_id", employeeId)
    .eq("tenant_id", tenantId);

  if (excludeAuthUid) {
    query = query.neq("auth_uid", excludeAuthUid);
  }

  const { data: existingAccount } = await query.maybeSingle();

  if (existingAccount) {
    return "This employee already has a user account";
  }

  return null;
}

export async function ensureClientAvailable(
  admin: AdminClient,
  clientId: string,
  tenantId: string,
  excludeAuthUid?: string,
) {
  const { data: client } = await admin
    .from("customers")
    .select("client_id")
    .eq("client_id", clientId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!client) {
    return "Client not found in your workspace";
  }

  let query = admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("client_id", clientId)
    .eq("tenant_id", tenantId);

  if (excludeAuthUid) {
    query = query.neq("auth_uid", excludeAuthUid);
  }

  const { data: existingAccount } = await query.maybeSingle();

  if (existingAccount) {
    return "This client already has a user account";
  }

  return null;
}

export async function ensureEmailAvailable(
  admin: AdminClient,
  email: string,
  tenantId: string,
  excludeAuthUid?: string,
) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return "Email is required";
  }

  let query = admin
    .from("user_accounts")
    .select("auth_uid")
    .ilike("email", normalizedEmail)
    .eq("tenant_id", tenantId);

  if (excludeAuthUid) {
    query = query.neq("auth_uid", excludeAuthUid);
  }

  const { data: existingAccount } = await query.maybeSingle();

  if (existingAccount) {
    return "Another account already uses this email";
  }

  return null;
}

export function validationErrorMessage(
  errors: Record<string, string | undefined>,
) {
  return (
    errors.role ??
    errors.employee_id ??
    errors.client_id ??
    errors.supervisor_site_codes ??
    "Invalid role assignment"
  );
}

export function roleRequiresEmployeeField(role: AppRole) {
  return roleRequiresEmployee(role);
}
