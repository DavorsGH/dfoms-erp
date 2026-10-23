import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import { clearAuthUserBan } from "@/utils/auth-session-revoke";
import { createAdminClient } from "@/utils/supabase/admin";

type ReactivateBody = {
  auth_uid?: string;
};

export async function POST(request: Request) {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;

  let body: ReactivateBody;
  try {
    body = (await request.json()) as ReactivateBody;
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
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!account) {
    return NextResponse.json({ error: "User account not found" }, { status: 404 });
  }

  if (account.is_active === true) {
    return NextResponse.json({ success: true });
  }

  const unbanned = await clearAuthUserBan(admin, auth_uid);
  if (!unbanned.ok) {
    return NextResponse.json({ error: unbanned.error }, { status: 400 });
  }

  const { error: updateError } = await admin
    .from("user_accounts")
    .update({ is_active: true })
    .eq("auth_uid", auth_uid)
    .eq("tenant_id", tenantId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
