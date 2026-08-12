import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import { recordPasswordUpdatedAt } from "@/lib/security/password-updated-at";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  mapSupabasePasswordError,
  validatePasswordLength,
} from "@/utils/password-policy";

type ResetPasswordBody = {
  auth_uid?: string;
  password?: string;
};

export async function POST(request: Request) {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;

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

  const lengthError = validatePasswordLength(password);
  if (lengthError) {
    return NextResponse.json({ error: lengthError }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: account } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("auth_uid", auth_uid)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ error: "User account not found" }, { status: 404 });
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(
    auth_uid,
    { password },
  );

  if (updateError) {
    return NextResponse.json(
      { error: mapSupabasePasswordError(updateError) },
      { status: 400 },
    );
  }

  await recordPasswordUpdatedAt(auth_uid);

  return NextResponse.json({ success: true });
}
