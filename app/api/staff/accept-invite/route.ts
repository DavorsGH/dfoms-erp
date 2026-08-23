import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  acceptStaffPortalInviteWithPassword,
  staffInviteHasExistingAuthAccount,
  REUSED_ACCOUNT_LOGIN_HINT,
} from "@/utils/staff-portal-invite";

type AcceptInviteBody = {
  token?: string;
  password?: string;
};

/**
 * GET: peek whether invite email already has Auth credentials (reuse UX).
 * POST: validate staff invite token, create or reassign Auth membership.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (!token) {
    return NextResponse.json({ error: "Invite token is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const result = await staffInviteHasExistingAuthAccount(admin, token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    existingAccount: result.existingAccount,
    message: result.existingAccount ? REUSED_ACCOUNT_LOGIN_HINT : null,
  });
}

export async function POST(request: Request) {
  let body: AcceptInviteBody;
  try {
    body = (await request.json()) as AcceptInviteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rawToken = body.token?.trim() ?? "";
  const password = body.password ?? "";

  if (!rawToken) {
    return NextResponse.json({ error: "Invite token is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const result = await acceptStaffPortalInviteWithPassword(
    admin,
    rawToken,
    password,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    reusedExistingAccount: result.reusedExistingAccount,
    message: result.reusedExistingAccount ? REUSED_ACCOUNT_LOGIN_HINT : null,
  });
}
