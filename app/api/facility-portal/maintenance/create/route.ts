import { NextResponse } from "next/server";
import { requireFacilityManagerSession } from "@/utils/facility-portal-auth";
import { assertFacilityLeaseOnAssignedProperty } from "@/utils/facility-portal-data";

type CreateBody = {
  lease_id?: string;
  description?: string;
  cost_ghs?: number | string | null;
};

export async function POST(request: Request) {
  const auth = await requireFacilityManagerSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { session, admin } = auth;
  if (!session.canManageMaintenance) {
    return NextResponse.json(
      { error: "You do not have permission to manage maintenance." },
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
  const description = body.description?.trim() ?? "";
  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }
  if (!description) {
    return NextResponse.json(
      { error: "description is required" },
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

  const nowIso = new Date().toISOString();
  const requestId = crypto.randomUUID();

  const { error: insertError } = await admin.from("maintenance_requests").insert({
    tenant_id: session.tenantId,
    request_id: requestId,
    lease_id: leaseCheck.leaseId,
    reported_by: "facility_manager",
    description,
    status: "submitted",
    cost_ghs: costGhs,
    landlord_approval_status: "pending",
    date_reported: nowIso,
    date_resolved: null,
    photo_urls: [],
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    request_id: requestId,
  });
}
