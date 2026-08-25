import { NextResponse } from "next/server";
import { isMaintenanceStatus } from "@/app/dashboard/real-estate/maintenance-utils";
import { requireFacilityManagerSession } from "@/utils/facility-portal-auth";
import { assertFacilityLeaseOnAssignedProperty } from "@/utils/facility-portal-data";

type UpdateStatusBody = {
  request_id?: string;
  status?: string;
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

  let body: UpdateStatusBody;
  try {
    body = (await request.json()) as UpdateStatusBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const requestId = body.request_id?.trim() ?? "";
  const status = body.status?.trim() ?? "";
  if (!requestId) {
    return NextResponse.json(
      { error: "request_id is required" },
      { status: 400 },
    );
  }
  if (!isMaintenanceStatus(status)) {
    return NextResponse.json(
      { error: "A valid maintenance status is required." },
      { status: 400 },
    );
  }

  const { data: existing, error: existingError } = await admin
    .from("maintenance_requests")
    .select(
      "request_id, lease_id, landlord_approval_status, cost_ghs, date_resolved",
    )
    .eq("tenant_id", session.tenantId)
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

  const leaseCheck = await assertFacilityLeaseOnAssignedProperty(
    admin,
    session,
    existing.lease_id as string,
  );
  if (!leaseCheck.ok) {
    return NextResponse.json(
      { error: leaseCheck.error },
      { status: leaseCheck.status },
    );
  }

  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status,
    updated_at: nowIso,
    date_resolved:
      status === "completed" ? (existing.date_resolved ?? nowIso) : null,
  };

  if (
    body.cost_ghs !== undefined &&
    existing.landlord_approval_status === "pending"
  ) {
    if (body.cost_ghs == null || String(body.cost_ghs).trim() === "") {
      updates.cost_ghs = null;
    } else {
      const parsed = Number(body.cost_ghs);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json(
          { error: "cost_ghs must be a non-negative number." },
          { status: 400 },
        );
      }
      updates.cost_ghs = parsed;
    }
  }

  const { error: updateError } = await admin
    .from("maintenance_requests")
    .update(updates)
    .eq("tenant_id", session.tenantId)
    .eq("request_id", requestId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
