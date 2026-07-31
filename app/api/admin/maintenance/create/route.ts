import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";

type CreateBody = {
  tenant_id?: string;
  lease_id?: string;
  description?: string;
  cost_ghs?: number | string | null;
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
  if (lease.status !== "active") {
    return NextResponse.json(
      { error: "Maintenance requests can only be created for active leases." },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();
  const requestId = crypto.randomUUID();

  const { error: insertError } = await admin.from("maintenance_requests").insert({
    tenant_id: landlord.tenantId,
    request_id: requestId,
    lease_id: leaseId,
    reported_by: "staff",
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
