import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  getCurrentUserRole,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
import { fetchPositions } from "../../employees/lookup-utils";
import LeaveSettings from "../leave-settings";
import type { LeaveApproverConfig } from "../../self-service/leave-request-utils";
import type { LeaveEntitlementPolicyRow } from "../leave-entitlement-policy-utils";
import {
  buildLeaveApproverChoices,
  type LeaveApproverAccount,
  type LeaveApproverEmployee,
} from "@/lib/leave-approver-options";

async function attachApproverNames(
  tenantId: string,
  history: LeaveApproverConfig[],
): Promise<LeaveApproverConfig[]> {
  const ids = [
    ...new Set(
      history
        .map((row) => row.approver_user_account_id)
        .filter((id) => id.length > 0),
    ),
  ];
  if (!ids.length) {
    return history;
  }

  const admin = createAdminClient();
  const { data: accounts } = await admin
    .from("user_accounts")
    .select("auth_uid, email, employee_id")
    .eq("tenant_id", tenantId)
    .in("auth_uid", ids);

  const employeeIds = [
    ...new Set(
      (accounts ?? [])
        .map((account) => account.employee_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: employees } = employeeIds.length
    ? await admin
        .from("employees")
        .select("employee_id, staff_id, full_name")
        .eq("tenant_id", tenantId)
        .in("employee_id", employeeIds)
    : { data: [] };

  const employeeById = new Map(
    (employees ?? []).map((employee) => [employee.employee_id, employee]),
  );
  const accountByAuth = new Map(
    (accounts ?? []).map((account) => [account.auth_uid, account]),
  );

  return history.map((row) => {
    const account = accountByAuth.get(row.approver_user_account_id);
    if (!account) {
      return { ...row, user_accounts: null };
    }
    const employee = account.employee_id
      ? employeeById.get(account.employee_id)
      : null;
    return {
      ...row,
      user_accounts: {
        email: account.email,
        employees: employee
          ? {
              full_name: employee.full_name,
              staff_id: employee.staff_id,
            }
          : null,
      },
    };
  });
}

export default async function LeaveSettingsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, role] = await Promise.all([
    getCurrentUserTenantId(),
    getCurrentUserRole(),
  ]);

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
          Leave Settings
        </h2>
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to resolve tenant for Leave Settings.
        </p>
      </>
    );
  }

  const admin = createAdminClient();
  const [
    { data: history, error: historyError },
    { data: employees, error: employeesError },
    { data: accounts, error: accountsError },
    positionLookups,
    { data: policies, error: policiesError },
  ] = await Promise.all([
    supabase
      .from("leave_approver_config")
      .select("id, approver_user_account_id, effective_from, notes, created_at")
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false }),
    admin
      .from("employees")
      .select("employee_id, staff_id, full_name, position, employment_status")
      .eq("tenant_id", tenantId)
      .eq("employment_status", "Active")
      .order("full_name"),
    admin
      .from("user_accounts")
      .select("auth_uid, employee_id, is_active, role")
      .eq("tenant_id", tenantId)
      .eq("is_active", true),
    fetchPositions(supabase),
    supabase
      .from("leave_entitlement_policy")
      .select("*")
      .eq("tenant_id", tenantId),
  ]);

  const approverHistory = await attachApproverNames(
    tenantId,
    (history as LeaveApproverConfig[] | null) ?? [],
  );
  const currentApprover = approverHistory[0] ?? null;

  const approverChoices = buildLeaveApproverChoices(
    (employees as LeaveApproverEmployee[] | null) ?? [],
    (accounts as LeaveApproverAccount[] | null) ?? [],
  );

  const fetchError =
    historyError?.message ??
    employeesError?.message ??
    accountsError?.message ??
    policiesError?.message ??
    null;

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Leave Settings
      </h2>
      <LeaveSettings
        tenantId={tenantId}
        currentApprover={currentApprover}
        history={approverHistory}
        canChangeApprover={role === "super_admin"}
        approverChoices={approverChoices}
        initialPositions={positionLookups.map((position) => position.name)}
        initialPolicies={(policies as LeaveEntitlementPolicyRow[] | null) ?? []}
        fetchError={fetchError}
      />
    </>
  );
}
