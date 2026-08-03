import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import {
  lookupLesseePortalAccount,
  resetLesseePortalPassword,
} from "@/utils/lessee-portal-account-management";

export const runtime = "nodejs";

type Body = {
  lessee_id?: string;
  password?: string;
};

/**
 * platform_only: set a new password for a lessee portal Auth user.
 * Same Auth Admin updateUserById pattern as /api/admin/users/reset-password.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const lesseeId =
    typeof body.lessee_id === "string" ? body.lessee_id.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!lesseeId) {
    return NextResponse.json({ error: "lessee_id is required" }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "password is required" }, { status: 400 });
  }

  const lookup = await lookupLesseePortalAccount(auth.admin, {
    tenantId: auth.session.tenantId,
    lesseeId,
  });
  if (!lookup.ok) {
    return NextResponse.json(
      { error: lookup.error },
      { status: lookup.status },
    );
  }

  const result = await resetLesseePortalPassword(
    auth.admin,
    lookup.account.authUserId,
    password,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
