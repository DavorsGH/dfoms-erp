import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { acknowledgeLeaseParty } from "@/utils/lease-signature";
import { voidNotifyLeaseFullySigned } from "@/utils/real-estate-document-notifications";

export const runtime = "nodejs";

type AcknowledgeBody = {
  lease_id?: string;
};

/**
 * Tenant portal: acknowledge the active lease as tenant.
 */
export async function POST(request: Request) {
  const session = await getPortalLesseeSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: AcknowledgeBody = {};
  try {
    body = (await request.json()) as AcknowledgeBody;
  } catch {
    // Empty body is fine — we resolve the active lease.
  }

  const admin = createAdminClient();

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lease_id, tenant_id, lessee_id, status")
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

  const requestedLeaseId = body.lease_id?.trim() ?? "";
  if (requestedLeaseId && requestedLeaseId !== lease.lease_id) {
    return NextResponse.json(
      { error: "lease_id does not match your active lease." },
      { status: 403 },
    );
  }

  const result = await acknowledgeLeaseParty({
    admin,
    tenantId: session.tenantId,
    leaseId: lease.lease_id,
    party: "tenant",
    acknowledgedBy: session.authUserId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (result.status === "signed") {
    voidNotifyLeaseFullySigned({
      tenantId: session.tenantId,
      leaseId: lease.lease_id,
    });
  }

  return NextResponse.json({ ok: true, status: result.status });
}
