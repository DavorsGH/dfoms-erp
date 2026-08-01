import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";

type CreateBody = {
  description?: string;
  tenant_self_fix?: boolean;
  proposed_cost_ghs?: number | string | null;
};

/**
 * Tenant Portal: submit a repair / maintenance request for the active lease.
 */
export async function POST(request: Request) {
  const session = await getPortalLesseeSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const description = body.description?.trim() ?? "";
  if (!description) {
    return NextResponse.json(
      { error: "description is required" },
      { status: 400 },
    );
  }

  const selfFix = Boolean(body.tenant_self_fix);
  let proposedCost: number | null = null;
  if (selfFix) {
    const parsed = Number(body.proposed_cost_ghs);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json(
        {
          error:
            "proposed_cost_ghs is required and must be a non-negative number for self-fix requests.",
        },
        { status: 400 },
      );
    }
    proposedCost = parsed;
  }

  const admin = createAdminClient();
  const landlord = await assertDavorsManagedLandlord(admin, session.tenantId);
  if (!landlord.ok) {
    return NextResponse.json(
      {
        error:
          "Repair requests are only available for Davors-managed properties.",
      },
      { status: 400 },
    );
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lease_id, status")
    .eq("tenant_id", session.tenantId)
    .eq("lessee_id", session.lesseeId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (leaseError) {
    return NextResponse.json({ error: leaseError.message }, { status: 400 });
  }
  if (!lease) {
    return NextResponse.json(
      { error: "No active lease found for your account." },
      { status: 404 },
    );
  }

  const nowIso = new Date().toISOString();
  const requestId = crypto.randomUUID();

  const { error: insertError } = await admin.from("maintenance_requests").insert({
    tenant_id: session.tenantId,
    request_id: requestId,
    lease_id: lease.lease_id,
    reported_by: "tenant",
    description,
    status: "submitted",
    cost_ghs: selfFix ? proposedCost : null,
    landlord_approval_status: "pending",
    tenant_self_fix: selfFix,
    proposed_cost_ghs: proposedCost,
    rent_credit_entry_id: null,
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
    tenant_self_fix: selfFix,
  });
}
