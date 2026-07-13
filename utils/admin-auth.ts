import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type SuperAdminResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

export async function requireSuperAdmin(): Promise<SuperAdminResult> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: account } = await supabase
    .from("user_accounts")
    .select("role, is_active")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (
    !account ||
    account.role !== "super_admin" ||
    account.is_active === false
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true };
}
