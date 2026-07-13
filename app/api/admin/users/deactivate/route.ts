import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";

type DeactivateBody = {
  auth_uid?: string;
};

export async function POST(request: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: DeactivateBody;
  try {
    body = (await request.json()) as DeactivateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { auth_uid } = body;

  if (!auth_uid) {
    return NextResponse.json({ error: "auth_uid is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: account, error: fetchError } = await admin
    .from("user_accounts")
    .select("auth_uid, is_active")
    .eq("auth_uid", auth_uid)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!account) {
    return NextResponse.json({ error: "User account not found" }, { status: 404 });
  }

  if (account.is_active === false) {
    return NextResponse.json({ success: true });
  }

  const { error: updateError } = await admin
    .from("user_accounts")
    .update({ is_active: false })
    .eq("auth_uid", auth_uid);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
