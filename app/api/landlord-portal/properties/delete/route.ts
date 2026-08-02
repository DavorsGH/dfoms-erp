import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";

type DeletePropertyBody = {
  property_id?: string;
};

/**
 * platform_only: delete a property (and its units) in the landlord's own tenant.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: DeletePropertyBody;
  try {
    body = (await request.json()) as DeletePropertyBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const propertyId = body.property_id?.trim() ?? "";
  if (!propertyId) {
    return NextResponse.json(
      { error: "property_id is required" },
      { status: 400 },
    );
  }

  const { error: unitsError } = await auth.admin
    .from("property_units")
    .delete()
    .eq("tenant_id", auth.session.tenantId)
    .eq("property_id", propertyId);

  if (unitsError) {
    return NextResponse.json({ error: unitsError.message }, { status: 400 });
  }

  const { data, error } = await auth.admin
    .from("properties")
    .delete()
    .eq("tenant_id", auth.session.tenantId)
    .eq("property_id", propertyId)
    .select("property_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
