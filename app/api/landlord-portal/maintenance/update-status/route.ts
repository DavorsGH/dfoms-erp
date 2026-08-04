import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";

type UpdateStatusBody = {
  request_id?: string;
};

/**
 * platform_only: mark an approved/in-progress maintenance request as completed.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdateStatusBody;
  try {
    body = (await request.json()) as UpdateStatusBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const requestId = body.request_id?.trim() ?? "";
  if (!requestId) {
    return NextResponse.json(
      { error: "request_id is required" },
      { status: 400 },
    );
  }

  const tenantId = auth.session.tenantId;

  const { data: existing, error: existingError } = await auth.admin
    .from("maintenance_requests")
    .select("request_id, status, landlord_approval_status, date_resolved")
    .eq("tenant_id", tenantId)
    .eq("request_id", requestId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Maintenance request not found." },
      { status: 404 },
    );
  }
  if (existing.status === "completed") {
    return NextResponse.json({ success: true, already_completed: true });
  }
  if (existing.status === "rejected") {
    return NextResponse.json(
      { error: "Rejected requests cannot be marked completed." },
      { status: 400 },
    );
  }
  if (existing.landlord_approval_status !== "approved") {
    return NextResponse.json(
      { error: "Landlord approval is required before completing this request." },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await auth.admin
    .from("maintenance_requests")
    .update({
      status: "completed",
      date_resolved: existing.date_resolved ?? nowIso,
      updated_at: nowIso,
    })
    .eq("tenant_id", tenantId)
    .eq("request_id", requestId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
