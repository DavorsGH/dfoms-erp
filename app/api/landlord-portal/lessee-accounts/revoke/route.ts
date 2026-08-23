import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { revokeLesseePortalAccess } from "@/utils/email-reuse";

export const runtime = "nodejs";

type Body = {
  lessee_id?: string;
};

/**
 * platform_only: clear lessees.auth_user_id + mark status former.
 * Auth user is kept (not banned/deleted) so the email can be reused sequentially.
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

  const result = await revokeLesseePortalAccess(auth.admin, {
    tenantId: auth.session.tenantId,
    lesseeId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400 },
    );
  }

  return NextResponse.json({ success: true });
}
