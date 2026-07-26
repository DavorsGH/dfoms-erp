import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { fetchPositions } from "../../employees/lookup-utils";
import LeaveSettings from "../leave-settings";
import type { LeaveApproverConfig } from "../../self-service/leave-request-utils";
import type { LeaveEntitlementPolicyRow } from "../leave-entitlement-policy-utils";

export default async function LeaveSettingsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

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

  const [
    { data: history, error: historyError },
    { data: userAccounts, error: accountsError },
    positionLookups,
    { data: policies, error: policiesError },
  ] = await Promise.all([
    supabase
      .from("leave_approver_config")
      .select(
        "*, user_accounts(email, employees!user_accounts_employee_id_fkey(full_name))",
      )
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("user_accounts")
      .select("auth_uid, email, employee_id, employees!user_accounts_employee_id_fkey(full_name)")
      .eq("is_active", true)
      .order("email"),
    fetchPositions(supabase),
    supabase
      .from("leave_entitlement_policy")
      .select("*")
      .eq("tenant_id", tenantId),
  ]);

  const approverHistory = (history as LeaveApproverConfig[] | null) ?? [];
  const currentApprover = approverHistory[0] ?? null;

  const accountOptions =
    (userAccounts ?? []).map((account) => {
      const employee = Array.isArray(account.employees)
        ? account.employees[0]
        : account.employees;

      return {
        auth_uid: account.auth_uid,
        email: account.email,
        full_name: employee?.full_name ?? account.email,
      };
    }) ?? [];

  const fetchError =
    historyError?.message ??
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
        userAccounts={accountOptions}
        initialPositions={positionLookups.map((position) => position.name)}
        initialPolicies={(policies as LeaveEntitlementPolicyRow[] | null) ?? []}
        fetchError={fetchError}
      />
    </>
  );
}
