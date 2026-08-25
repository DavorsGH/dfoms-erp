import { NextResponse } from "next/server";
import { requireFacilityManagerSession } from "@/utils/facility-portal-auth";
import { assertFacilityLeaseOnAssignedProperty } from "@/utils/facility-portal-data";
import {
  isInspectionType,
  sanitizeInspectionChecklist,
} from "@/app/dashboard/real-estate/inspections-utils";

type CreateBody = {
  lease_id?: string;
  inspection_type?: string;
  inspection_date?: string;
  notes?: string | null;
  checklist?: unknown;
};

export async function POST(request: Request) {
  const auth = await requireFacilityManagerSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { session, admin } = auth;
  if (!session.canManageInspections) {
    return NextResponse.json(
      { error: "You do not have permission to manage inspections." },
      { status: 403 },
    );
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const leaseId = body.lease_id?.trim() ?? "";
  const inspectionType = body.inspection_type?.trim() ?? "";
  const inspectionDate = body.inspection_date?.trim() ?? "";
  const notes = body.notes?.trim() || null;

  if (!isInspectionType(inspectionType)) {
    return NextResponse.json(
      { error: "inspection_type must be move_in or move_out." },
      { status: 400 },
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inspectionDate)) {
    return NextResponse.json(
      { error: "inspection_date must be YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const checklist = sanitizeInspectionChecklist(body.checklist);
  if ("error" in checklist) {
    return NextResponse.json({ error: checklist.error }, { status: 400 });
  }

  const leaseCheck = await assertFacilityLeaseOnAssignedProperty(
    admin,
    session,
    leaseId,
    { requireActive: true },
  );
  if (!leaseCheck.ok) {
    return NextResponse.json(
      { error: leaseCheck.error },
      { status: leaseCheck.status },
    );
  }

  const conductedBy = session.fullName?.trim() || "Facility Manager";
  const nowIso = new Date().toISOString();
  const inspectionId = crypto.randomUUID();

  const { error: insertError } = await admin.from("inspections").insert({
    tenant_id: session.tenantId,
    inspection_id: inspectionId,
    lease_id: leaseCheck.leaseId,
    inspection_type: inspectionType,
    inspection_date: inspectionDate,
    conducted_by: conductedBy,
    checklist,
    photo_urls: [],
    notes,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    inspection_id: inspectionId,
  });
}
