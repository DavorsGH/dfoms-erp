import "server-only";

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export async function getCurrentUserRole(): Promise<string | null> {
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
    .select("role")
    .eq("auth_uid", user.id)
    .maybeSingle();

  return account?.role ?? null;
}

export async function isSuperAdmin(): Promise<boolean> {
  const role = await getCurrentUserRole();
  return role === "super_admin";
}
