import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import AdministrationNav from "../administration-nav";
import LeaveSettings from "../leave-settings";
import type { LeaveApproverConfig } from "../../self-service/leave-request-utils";

export default async function LeaveSettingsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: history, error: historyError },
    { data: userAccounts, error: accountsError },
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

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        Administration
      </h1>
      <AdministrationNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Leave Settings
      </h2>
      <LeaveSettings
        currentApprover={currentApprover}
        history={approverHistory}
        userAccounts={accountOptions}
        fetchError={historyError?.message ?? accountsError?.message ?? null}
      />
    </>
  );
}
