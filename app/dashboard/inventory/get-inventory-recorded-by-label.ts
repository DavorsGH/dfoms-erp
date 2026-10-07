import type { SupabaseClient } from "@supabase/supabase-js";
import { getRoleLabel } from "../role-labels";

export async function getInventoryRecordedByLabel(
  supabase: SupabaseClient,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email ?? "Unknown user";

  if (!user) {
    return email;
  }

  const { data: account } = await supabase
    .from("user_accounts")
    .select("employee_id, role")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (!account?.employee_id) {
    return email;
  }

  const { data: employee } = await supabase
    .from("employees")
    .select("full_name")
    .eq("employee_id", account.employee_id)
    .maybeSingle();

  if (employee?.full_name) {
    return account.role
      ? `${employee.full_name} [${getRoleLabel(account.role)}]`
      : employee.full_name;
  }

  return email;
}
