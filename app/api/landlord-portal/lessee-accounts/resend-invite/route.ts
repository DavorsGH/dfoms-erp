import { NextResponse } from "next/server";
import { requireApprovedLandlordSession } from "@/utils/landlord-portal-auth";
import { createAndSendLesseePortalInvite } from "@/utils/lessee-portal-invite";

export const runtime = "nodejs";

type ResendBody = {
  lessee_id?: string;
};

/**
 * Landlord portal: resend (or send) a lessee tenant-portal invite for a
 * lessee in the landlord's own tenant_id. Does not create staff user accounts.
 */
export async function POST(request: Request) {
  const auth = await requireApprovedLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: ResendBody;
  try {
    body = (await request.json()) as ResendBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const lesseeId =
    typeof body.lessee_id === "string" ? body.lessee_id.trim() : "";
  if (!lesseeId) {
    return NextResponse.json({ error: "lessee_id is required" }, { status: 400 });
  }

  const result = await createAndSendLesseePortalInvite(auth.admin, {
    tenantId: auth.session.tenantId,
    lesseeId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (result.status === "skipped") {
    return NextResponse.json(
      { error: result.reason, skipped: true },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, status: "sent" });
}
