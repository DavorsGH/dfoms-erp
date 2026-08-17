import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { acceptStaffPortalInviteWithPassword } from "@/utils/staff-portal-invite";

type AcceptInviteBody = {
  token?: string;
  password?: string;
};

/**
 * Public endpoint: validate staff invite token, create Auth user, insert user_accounts.
 */
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

  return NextResponse.json({ success: true });
}
