import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getRoleLabel } from "./role-labels";
import Sidebar from "./sidebar";
import TopBar from "./top-bar";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email ?? "";
  let userLabel = email;

  const { data: account } = await supabase
    .from("user_accounts")
    .select("employee_id, role")
    .eq("auth_uid", user!.id)
    .maybeSingle();

  if (account?.employee_id && account.role) {
    const { data: employee } = await supabase
      .from("employees")
      .select("full_name")
      .eq("employee_id", account.employee_id)
      .maybeSingle();

    if (employee?.full_name) {
      userLabel = `${employee.full_name} [${getRoleLabel(account.role)}]`;
    }
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopBar userLabel={userLabel} />
        <main className="min-w-0 flex-1 overflow-x-auto bg-slate-50 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
