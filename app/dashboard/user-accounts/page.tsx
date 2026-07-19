import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId, isSuperAdmin } from "@/utils/dashboard-auth";
import {
  mapUserAccountRows,
  USER_ACCOUNT_SELECT,
} from "../user-account-utils";
import type { Employee } from "../lookup-types";
import AdministrationShell from "../administration/administration-shell";
import UserAccounts from "../administration/user-accounts";

export default async function UserAccountsPage() {
  if (!(await isSuperAdmin())) {
    redirect("/dashboard");
  }

  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    redirect("/dashboard");
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: accounts, error: accountsError },
    { data: employees, error: employeesError },
    { data: clients, error: clientsError },
    { data: sites, error: sitesError },
  ] = await Promise.all([
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
  ]);

  return (
    <AdministrationShell>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        User Accounts
      </h2>
      <UserAccounts
        initialAccounts={mapUserAccountRows(accounts ?? [])}
        initialEmployees={(employees as Employee[] | null) ?? []}
        initialClients={clients ?? []}
        initialSites={sites ?? []}
        fetchError={
          accountsError?.message ??
          employeesError?.message ??
          clientsError?.message ??
          sitesError?.message ??
          null
        }
      />
    </AdministrationShell>
  );
}
