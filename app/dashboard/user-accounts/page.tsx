import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isSuperAdmin } from "@/utils/dashboard-auth";
import {
  mapUserAccountRows,
  USER_ACCOUNT_SELECT,
} from "../user-account-utils";
import type { Employee } from "../lookup-types";
import UserAccounts from "../administration/user-accounts";

export default async function UserAccountsPage() {
  if (!(await isSuperAdmin())) {
    redirect("/dashboard");
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const admin = createAdminClient();

  const [
    { data: accounts, error: accountsError },
    { data: employees, error: employeesError },
    { data: clients, error: clientsError },
    { data: sites, error: sitesError },
  ] = await Promise.all([
    admin
      .from("user_accounts")
      .select(USER_ACCOUNT_SELECT)
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
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        User Accounts
      </h1>
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
    </div>
  );
}
