import "server-only";

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export async function getCurrentUserFullName(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: account } = await supabase
    .from("user_accounts")
    .select("employee_id")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (!account?.employee_id) {
    return null;
  }

  const { data: employee } = await supabase
    .from("employees")
    .select("full_name")
    .eq("employee_id", account.employee_id)
    .maybeSingle();

  return employee?.full_name?.trim() || null;
}
