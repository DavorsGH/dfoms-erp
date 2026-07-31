import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";

type DeletePropertyBody = {
  tenant_id?: string;
  property_id?: string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
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

  const { error: unitsError } = await admin
    .from("property_units")
    .delete()
    .eq("tenant_id", landlord.tenantId)
    .eq("property_id", propertyId);

  if (unitsError) {
    return NextResponse.json({ error: unitsError.message }, { status: 400 });
  }

  const { data, error } = await admin
    .from("properties")
    .delete()
    .eq("tenant_id", landlord.tenantId)
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
