import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
import {
  isInspectionType,
  sanitizeInspectionChecklist,
} from "@/app/dashboard/real-estate/inspections-utils";

type CreateBody = {
  tenant_id?: string;
  lease_id?: string;
  inspection_type?: string;
  inspection_date?: string;
  conducted_by?: string;
  notes?: string | null;
  checklist?: unknown;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
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
  const conductedBy = body.conducted_by?.trim() ?? "";
  const notes = body.notes?.trim() || null;

  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }
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
  if (!conductedBy) {
    return NextResponse.json(
      { error: "conducted_by is required" },
      { status: 400 },
    );
  }

  const checklist = sanitizeInspectionChecklist(body.checklist);
  if ("error" in checklist) {
    return NextResponse.json({ error: checklist.error }, { status: 400 });
  }

  const admin = createAdminClient();
  const landlord = await assertDavorsManagedLandlord(admin, body.tenant_id ?? "");
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lease_id, status")
    .eq("tenant_id", landlord.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (leaseError) {
    return NextResponse.json({ error: leaseError.message }, { status: 400 });
  }
  if (!lease) {
    return NextResponse.json({ error: "Lease not found." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const inspectionId = crypto.randomUUID();

  const { error: insertError } = await admin.from("inspections").insert({
    tenant_id: landlord.tenantId,
    inspection_id: inspectionId,
    lease_id: leaseId,
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
