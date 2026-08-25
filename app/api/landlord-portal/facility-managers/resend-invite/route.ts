import { NextResponse } from "next/server";
import { requireApprovedLandlordSession } from "@/utils/landlord-portal-auth";
import { createAndSendFacilityManagerPortalInvite } from "@/utils/facility-manager-portal-invite";

export const runtime = "nodejs";

type ResendBody = {
  facility_manager_id?: string;
};

/**
 * Invalidate unused invite tokens and issue a new one.
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

  const facilityManagerId =
    typeof body.facility_manager_id === "string"
      ? body.facility_manager_id.trim()
      : "";
  if (!facilityManagerId) {
    return NextResponse.json(
      { error: "facility_manager_id is required" },
      { status: 400 },
    );
  }

  const { data: fm, error } = await auth.admin
    .from("facility_managers")
    .select("facility_manager_id, status, auth_user_id")
    .eq("tenant_id", auth.session.tenantId)
    .eq("facility_manager_id", facilityManagerId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!fm) {
    return NextResponse.json(
      { error: "Facility manager not found." },
      { status: 404 },
    );
  }
  if (fm.status === "revoked") {
    return NextResponse.json(
      { error: "Cannot resend invite for a revoked facility manager." },
      { status: 400 },
    );
  }
  if (fm.auth_user_id) {
    return NextResponse.json(
      { error: "Facility manager already has a portal account.", skipped: true },
      { status: 409 },
    );
  }

  const result = await createAndSendFacilityManagerPortalInvite(auth.admin, {
    tenantId: auth.session.tenantId,
    facilityManagerId,
    landlordName: auth.session.fullName,
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
