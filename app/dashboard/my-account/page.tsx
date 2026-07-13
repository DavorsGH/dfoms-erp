import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getRoleLabel } from "../role-labels";
import ChangePasswordForm from "./change-password-form";

export default async function MyAccountPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email ?? "";

  const { data: account } = await supabase
    .from("user_accounts")
    .select("employee_id, role")
    .eq("auth_uid", user!.id)
    .maybeSingle();

  let fullName = email;

  if (account?.employee_id) {
    const { data: employee } = await supabase
      .from("employees")
      .select("full_name")
      .eq("employee_id", account.employee_id)
      .maybeSingle();

    if (employee?.full_name) {
      fullName = employee.full_name;
    }
  }

  const roleLabel = account?.role ? getRoleLabel(account.role) : "—";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-[#0f2744]">My Account</h1>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
          Profile
        </h2>
        <dl className="grid max-w-md gap-4 text-sm">
          <div>
            <dt className="font-medium text-slate-500">Name</dt>
            <dd className="mt-1 text-slate-900">{fullName}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Email</dt>
            <dd className="mt-1 text-slate-900">{email}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Role</dt>
            <dd className="mt-1 text-slate-900">{roleLabel}</dd>
          </div>
        </dl>
      </section>

      <ChangePasswordForm />
    </div>
  );
}
