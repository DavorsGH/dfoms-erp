import { NextResponse } from "next/server";
import { requireFacilityManagerSession } from "@/utils/facility-portal-auth";
import { facilityManagerHasProperty } from "@/utils/facility-portal-data";

const SERVICE_TYPES = new Set(["cleaning", "gardening", "other"]);

type CreateBody = {
  property_id?: string;
  unit_id?: string | null;
  service_type?: string;
  service_date?: string;
  cost_ghs?: number | string | null;
  notes?: string | null;
};

export async function POST(request: Request) {
  const auth = await requireFacilityManagerSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { session, admin } = auth;
  if (!session.canLogServices) {
    return NextResponse.json(
      { error: "You do not have permission to log services." },
      { status: 403 },
    );
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const propertyId = body.property_id?.trim() ?? "";
  const serviceType = body.service_type?.trim() ?? "";
  const serviceDate = body.service_date?.trim() ?? "";
  const unitId = body.unit_id?.trim() || null;
  const notes = body.notes?.trim() || null;

  if (!propertyId) {
    return NextResponse.json(
      { error: "property_id is required" },
      { status: 400 },
    );
  }
  if (!facilityManagerHasProperty(session, propertyId)) {
    return NextResponse.json(
      { error: "You are not assigned to this property." },
      { status: 403 },
    );
  }
  if (!SERVICE_TYPES.has(serviceType)) {
    return NextResponse.json(
      { error: "service_type must be cleaning, gardening, or other." },
      { status: 400 },
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    return NextResponse.json(
      { error: "service_date must be YYYY-MM-DD." },
      { status: 400 },
    );
  }

  let costGhs: number | null = null;
  if (body.cost_ghs != null && String(body.cost_ghs).trim() !== "") {
    const parsed = Number(body.cost_ghs);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json(
        { error: "cost_ghs must be a non-negative number." },
        { status: 400 },
      );
    }
    costGhs = parsed;
  }

  if (unitId) {
    const { data: unit, error: unitError } = await admin
      .from("property_units")
      .select("unit_id, property_id")
      .eq("tenant_id", session.tenantId)
      .eq("unit_id", unitId)
      .maybeSingle();

    if (unitError) {
      return NextResponse.json({ error: unitError.message }, { status: 400 });
    }
    if (!unit || unit.property_id !== propertyId) {
      return NextResponse.json(
        { error: "Unit not found on the selected property." },
        { status: 400 },
      );
    }
  }

  const recordId = crypto.randomUUID();
  const { error: insertError } = await admin
    .from("property_service_records")
    .insert({
      record_id: recordId,
      tenant_id: session.tenantId,
      property_id: propertyId,
      unit_id: unitId,
      service_type: serviceType,
      service_date: serviceDate,
      cost_ghs: costGhs,
      notes,
      logged_by_facility_manager_id: session.facilityManagerId,
      logged_by_auth_uid: session.authUserId,
    });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    record_id: recordId,
  });
}
