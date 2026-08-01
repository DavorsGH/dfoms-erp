import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";

type RequestBody = {
  reason?: string | null;
};

/**
 * Tenant Portal: submit an early-termination request (pending staff approval).
 * Does not terminate the lease.
 */
export async function POST(request: Request) {
  const session = await getPortalLesseeSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    body = {};
  }

  const reason =
    typeof body.reason === "string" ? body.reason.trim() || null : null;

  const admin = createAdminClient();

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select(
      "lease_id, tenant_id, lessee_id, status, termination_request_status",
    )
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

  if (lease.termination_request_status === "pending_staff_approval") {
    return NextResponse.json(
      { error: "You already have a pending early-termination request." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from("leases")
    .update({
      pending_termination_reason: reason,
      termination_request_status: "pending_staff_approval",
      updated_at: now,
    })
    .eq("tenant_id", session.tenantId)
    .eq("lease_id", lease.lease_id)
    .eq("status", "active");

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    lease_id: lease.lease_id,
    termination_request_status: "pending_staff_approval",
  });
}
