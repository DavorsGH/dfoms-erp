import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import {
  isUnitStatus,
  type UnitStatus,
} from "@/app/dashboard/real-estate/properties-utils";

type CreateUnitBody = {
  tenant_id?: string;
  property_id?: string;
  unit_number?: string;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  base_rent_ghs?: number | string;
  status?: string;
};

function parseOptionalInteger(
  value: number | string | null | undefined,
  field: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value == null || value === "") {
    return { ok: true, value: null };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return {
      ok: false,
      error: `${field} must be a non-negative whole number.`,
    };
  }
  return { ok: true, value: parsed };
}

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: CreateUnitBody;
  try {
    body = (await request.json()) as CreateUnitBody;
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

  const { data: property, error: propertyError } = await admin
    .from("properties")
    .select("property_id")
    .eq("tenant_id", landlord.tenantId)
    .eq("property_id", propertyId)
    .maybeSingle();

  if (propertyError) {
    return NextResponse.json({ error: propertyError.message }, { status: 400 });
  }
  if (!property) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  const unitNumber = body.unit_number?.trim() ?? "";
  if (!unitNumber) {
    return NextResponse.json(
      { error: "unit_number is required" },
      { status: 400 },
    );
  }

  const bedrooms = parseOptionalInteger(body.bedrooms, "bedrooms");
  if (!bedrooms.ok) {
    return NextResponse.json({ error: bedrooms.error }, { status: 400 });
  }
  const bathrooms = parseOptionalInteger(body.bathrooms, "bathrooms");
  if (!bathrooms.ok) {
    return NextResponse.json({ error: bathrooms.error }, { status: 400 });
  }

  const baseRent = Number(body.base_rent_ghs);
  if (!Number.isFinite(baseRent) || baseRent < 0) {
    return NextResponse.json(
      { error: "base_rent_ghs must be a non-negative number." },
      { status: 400 },
    );
  }

  const status = body.status?.trim() ?? "";
  if (!isUnitStatus(status)) {
    return NextResponse.json(
      {
        error:
          "status must be vacant, occupied, or under_maintenance.",
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const unitId = crypto.randomUUID();

  const { error } = await admin.from("property_units").insert({
    tenant_id: landlord.tenantId,
    unit_id: unitId,
    property_id: propertyId,
    unit_number: unitNumber,
    bedrooms: bedrooms.value,
    bathrooms: bathrooms.value,
    base_rent_ghs: baseRent,
    status: status as UnitStatus,
    photo_urls: [],
    created_at: now,
    updated_at: now,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, unit_id: unitId });
}
