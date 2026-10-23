import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  getCurrentAuthUser,
  getCurrentUserTenantId,
  isSuperAdmin,
} from "@/utils/dashboard-auth";
import {
  mapUserAccountRows,
  USER_ACCOUNT_SELECT,
} from "../../user-account-utils";
import type { Employee } from "../../lookup-types";
import AdministrationShell from "../../administration/administration-shell";
import UserAccountDetail from "../../administration/user-account-detail";

type PageProps = {
  params: Promise<{ authUid: string }>;
};

export default async function UserAccountDetailPage({ params }: PageProps) {
  if (!(await isSuperAdmin())) {
    redirect("/dashboard");
  }

  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    redirect("/dashboard");
  }

  const { authUid: rawAuthUid } = await params;
  const authUid = rawAuthUid.trim();
  if (!authUid) {
    redirect("/dashboard/user-accounts");
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const currentUser = await getCurrentAuthUser();

  const [
    { data: accountRow, error: accountError },
    { data: accounts, error: accountsError },
    { data: employees, error: employeesError },
    { data: clients, error: clientsError },
    { data: sites, error: sitesError },
    { data: businessUnits, error: businessUnitsError },
  ] = await Promise.all([
    supabase
      .from("user_accounts")
      .select(USER_ACCOUNT_SELECT)
      .eq("tenant_id", tenantId)
      .eq("auth_uid", authUid)
      .maybeSingle(),
    supabase
      .from("user_accounts")
      .select(USER_ACCOUNT_SELECT)
      .eq("tenant_id", tenantId)
      .order("email", { ascending: true }),
    supabase
      .from("employees")
      .select("employee_id, full_name")
      .order("full_name", { ascending: true }),
    supabase
      .from("customers")
      .select("client_id, client_name")
      .order("client_name", { ascending: true }),
    supabase
      .from("sites")
      .select("site_code, site_name")
      .order("site_name", { ascending: true }),
    supabase
      .from("business_units")
      .select("id, name, is_active")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const fetchError =
    accountError?.message ??
    accountsError?.message ??
    employeesError?.message ??
    clientsError?.message ??
    sitesError?.message ??
    businessUnitsError?.message ??
    null;

  if (fetchError) {
    return (
      <AdministrationShell>
        <Link
          href="/dashboard/user-accounts"
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Back to User Accounts
        </Link>
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </div>
      </AdministrationShell>
    );
  }

  if (!accountRow) {
    return (
      <AdministrationShell>
        <Link
          href="/dashboard/user-accounts"
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Back to User Accounts
        </Link>
        <div className="mt-4 rounded-md border border-slate-200 bg-white px-4 py-8 text-center text-slate-600 shadow-sm">
          User account not found.
        </div>
      </AdministrationShell>
    );
  }

  const mappedAccounts = mapUserAccountRows(accounts ?? []);
  const account =
    mappedAccounts.find((entry) => entry.auth_uid === authUid) ??
    mapUserAccountRows([accountRow])[0]!;

  return (
    <AdministrationShell>
      <UserAccountDetail
        tenantId={tenantId}
        currentUserAuthUid={currentUser?.id ?? null}
        account={account}
        allAccounts={mappedAccounts}
        employees={(employees as Employee[] | null) ?? []}
        clients={clients ?? []}
        sites={sites ?? []}
        businessUnits={businessUnits ?? []}
      />
    </AdministrationShell>
  );
}
