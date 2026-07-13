import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isSuperAdmin } from "@/utils/dashboard-auth";
import { mapUserAccountRows } from "../user-account-utils";
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
  ] = await Promise.all([
    admin
      .from("user_accounts")
      .select("auth_uid, employee_id, email, role, is_active, employees(full_name)")
      .order("email", { ascending: true }),
    supabase
      .from("employees")
      .select("employee_id, full_name")
      .order("full_name", { ascending: true }),
  ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        User Accounts
      </h1>
      <UserAccounts
        initialAccounts={mapUserAccountRows(accounts ?? [])}
        initialEmployees={(employees as Employee[] | null) ?? []}
        fetchError={accountsError?.message ?? employeesError?.message ?? null}
      />
    </div>
  );
}
