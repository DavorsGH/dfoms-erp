import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";

type ResetPasswordBody = {
  auth_uid?: string;
  password?: string;
};

export async function POST(request: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: ResetPasswordBody;
  try {
    body = (await request.json()) as ResetPasswordBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { auth_uid, password } = body;

  if (!auth_uid || !password) {
    return NextResponse.json(
      { error: "auth_uid and password are required" },
      { status: 400 },
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: account } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("auth_uid", auth_uid)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ error: "User account not found" }, { status: 404 });
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(
    auth_uid,
    { password },
  );

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
