import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { createAndSendLesseePortalInvite } from "@/utils/lessee-portal-invite";

type Body = {
  tenant_id?: string;
  lessee_id?: string;
};

/**
 * Staff Real Estate: send or resend a Tenant Portal invite for a lessee.
 * Reuses createAndSendLesseePortalInvite (invalidates prior unused invites).
 */
export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const lesseeId = body.lessee_id?.trim() ?? "";
  if (!lesseeId) {
    return NextResponse.json({ error: "lessee_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const landlord = await assertRealEstateLandlordTenant(
    admin,
    body.tenant_id ?? "",
  );
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const result = await createAndSendLesseePortalInvite(admin, {
    tenantId: landlord.tenantId,
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
