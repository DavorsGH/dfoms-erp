import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import {
  isUnitStatus,
  normalizePhotoUrls,
  type UnitStatus,
} from "@/app/dashboard/real-estate/properties-utils";

type UpdateUnitBody = {
  tenant_id?: string;
  unit_id?: string;
  unit_number?: string;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  base_rent_ghs?: number | string;
  status?: string;
  photo_urls?: unknown;
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

  let body: UpdateUnitBody;
  try {
    body = (await request.json()) as UpdateUnitBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const unitId = body.unit_id?.trim() ?? "";
  if (!unitId) {
    return NextResponse.json({ error: "unit_id is required" }, { status: 400 });
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

  const photoUrls = normalizePhotoUrls(body.photo_urls);

  const { data, error } = await admin
    .from("property_units")
    .update({
      unit_number: unitNumber,
      bedrooms: bedrooms.value,
      bathrooms: bathrooms.value,
      base_rent_ghs: baseRent,
      status: status as UnitStatus,
      photo_urls: photoUrls,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("unit_id", unitId)
    .select("unit_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Unit not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
