import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
import {
  isInspectionType,
  sanitizeInspectionChecklist,
} from "@/app/dashboard/real-estate/inspections-utils";
import { normalizePhotoUrls } from "@/app/dashboard/real-estate/properties-utils";

type UpdateBody = {
  tenant_id?: string;
  inspection_id?: string;
  inspection_type?: string;
  inspection_date?: string;
  conducted_by?: string;
  notes?: string | null;
  checklist?: unknown;
  photo_urls?: unknown;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const inspectionId = body.inspection_id?.trim() ?? "";
  const inspectionType = body.inspection_type?.trim() ?? "";
  const inspectionDate = body.inspection_date?.trim() ?? "";
  const conductedBy = body.conducted_by?.trim() ?? "";
  const notes = body.notes?.trim() || null;

  if (!inspectionId) {
    return NextResponse.json(
      { error: "inspection_id is required" },
      { status: 400 },
    );
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

  const photoUrls = normalizePhotoUrls(body.photo_urls);

  const admin = createAdminClient();
  const landlord = await assertDavorsManagedLandlord(admin, body.tenant_id ?? "");
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const { data: existing, error: existingError } = await admin
    .from("inspections")
    .select("inspection_id")
    .eq("tenant_id", landlord.tenantId)
    .eq("inspection_id", inspectionId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Inspection not found." },
      { status: 404 },
    );
  }

  const { error: updateError } = await admin
    .from("inspections")
    .update({
      inspection_type: inspectionType,
      inspection_date: inspectionDate,
      conducted_by: conductedBy,
      checklist,
      notes,
      photo_urls: photoUrls,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("inspection_id", inspectionId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
