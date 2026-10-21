import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  buildActiveStaffChoices,
  type ActiveStaffAccount,
  type ActiveStaffEmployee,
} from "@/lib/active-staff-options";
import {
  FINANCE_APPROVER_ACCOUNT_SELECT,
  FINANCE_APPROVER_SELECT,
  buildFinanceApproverFormLookups,
} from "@/lib/finance-approver-lookups";
import type { Approver } from "../../lookup-types";
import Approvers from "../approvers";

export default async function ApproversPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Approvers</h2>
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to resolve tenant for Approvers.
        </p>
      </>
    );
  }

  const admin = createAdminClient();
  const [
    { data: approvers, error: approversError },
    { data: employees, error: employeesError },
    { data: accounts, error: accountsError },
  ] = await Promise.all([
    supabase
      .from("approvers")
      .select(FINANCE_APPROVER_SELECT)
      .eq("tenant_id", tenantId)
      .order("employee_id", { ascending: true }),
    admin
      .from("employees")
      .select("employee_id, staff_id, full_name, employment_status")
      .eq("tenant_id", tenantId)
      .eq("employment_status", "Active")
      .order("full_name", { ascending: true }),
    admin
      .from("user_accounts")
      .select(FINANCE_APPROVER_ACCOUNT_SELECT)
      .eq("tenant_id", tenantId)
      .eq("is_active", true),
  ]);

  const accountRows = (accounts as ActiveStaffAccount[] | null) ?? [];
  const { allApprovers } = buildFinanceApproverFormLookups(
    approvers ?? [],
    accountRows,
  );
  const pickerChoices = buildActiveStaffChoices(
    (employees as ActiveStaffEmployee[] | null) ?? [],
    accountRows,
  );

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Approvers</h2>
      <Approvers
        tenantId={tenantId}
        initialApprovers={allApprovers as Approver[]}
        pickerChoices={pickerChoices}
        fetchError={
          approversError?.message ??
          employeesError?.message ??
          accountsError?.message ??
          null
        }
      />
    </>
  );
}
