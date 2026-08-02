import { NextResponse } from "next/server";
import { requireApprovedLandlordSession } from "@/utils/landlord-portal-auth";
import { createRentalApplicationLink } from "@/utils/rental-application-links";

type Body = {
  unit_id?: string;
  property_id?: string;
};

/**
 * Both landlord types may generate shareable apply links for vacant units.
 */
export async function POST(request: Request) {
  const auth = await requireApprovedLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const unitId = body.unit_id?.trim() ?? "";
  const propertyId = body.property_id?.trim() ?? "";
  if (!unitId || !propertyId) {
    return NextResponse.json(
      { error: "unit_id and property_id are required" },
      { status: 400 },
    );
  }

  const result = await createRentalApplicationLink(auth.admin, {
    tenantId: auth.session.tenantId,
    propertyId,
    unitId,
    createdBy: auth.session.authUserId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    link_id: result.linkId,
    url: result.url,
    expires_at: result.expiresAt,
  });
}
