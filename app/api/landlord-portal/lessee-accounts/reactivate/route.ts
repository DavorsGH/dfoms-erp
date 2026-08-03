import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import {
  lookupLesseePortalAccount,
  reactivateLesseePortalAccess,
} from "@/utils/lessee-portal-account-management";

export const runtime = "nodejs";

type Body = {
  lessee_id?: string;
};

/**
 * platform_only: lift Auth ban so the lessee can sign in again.
 * Does not recreate Auth users or send invites.
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
  if (!lesseeId) {
    return NextResponse.json({ error: "lessee_id is required" }, { status: 400 });
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

  const result = await reactivateLesseePortalAccess(
    auth.admin,
    lookup.account.authUserId,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
