import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import {
  isPropertyType,
  type PropertyType,
} from "@/app/dashboard/real-estate/properties-utils";

type CreatePropertyBody = {
  name?: string;
  property_type?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  region?: string;
};

/**
 * platform_only: create a property in the landlord's own tenant.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: CreatePropertyBody;
  try {
    body = (await request.json()) as CreatePropertyBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  const propertyType = body.property_type?.trim() ?? "";
  const addressLine1 = body.address_line1?.trim() ?? "";
  const addressLine2 = body.address_line2?.trim() ?? "";
  const city = body.city?.trim() ?? "";
  const region = body.region?.trim() ?? "";

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!isPropertyType(propertyType)) {
    return NextResponse.json(
      { error: "property_type must be residential, commercial, or mixed_use." },
      { status: 400 },
    );
  }
  if (!addressLine1) {
    return NextResponse.json(
      { error: "address_line1 is required" },
      { status: 400 },
    );
  }
  if (!addressLine2) {
    return NextResponse.json(
      { error: "address_line2 is required" },
      { status: 400 },
    );
  }
  if (!city) {
    return NextResponse.json({ error: "city is required" }, { status: 400 });
  }
  if (!region) {
    return NextResponse.json({ error: "region is required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const propertyId = crypto.randomUUID();

  const { error } = await auth.admin.from("properties").insert({
    tenant_id: auth.session.tenantId,
    property_id: propertyId,
    name,
    property_type: propertyType as PropertyType,
    address_line1: addressLine1,
    address_line2: addressLine2,
    city,
    region,
    photo_urls: [],
    created_at: now,
    updated_at: now,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, property_id: propertyId });
}
