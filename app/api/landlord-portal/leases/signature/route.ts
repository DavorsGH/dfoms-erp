import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import {
  acknowledgeLeaseParty,
  markLeaseSent,
} from "@/utils/lease-signature";

export const runtime = "nodejs";

type SignatureBody = {
  lease_id?: string;
  action?: string;
};

/**
 * platform_only landlord: mark lease sent or acknowledge as landlord.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: SignatureBody;
  try {
    body = (await request.json()) as SignatureBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const leaseId = body.lease_id?.trim() ?? "";
  const action = body.action?.trim() ?? "";
  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }
  if (action !== "mark_sent" && action !== "acknowledge_landlord") {
    return NextResponse.json(
      { error: "action must be mark_sent or acknowledge_landlord" },
      { status: 400 },
    );
  }

  const { data: lease, error: leaseError } = await auth.admin
    .from("leases")
    .select("lease_id")
    .eq("tenant_id", auth.session.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (leaseError) {
    return NextResponse.json({ error: leaseError.message }, { status: 400 });
  }
  if (!lease) {
    return NextResponse.json({ error: "Lease not found." }, { status: 404 });
  }

  if (action === "mark_sent") {
    const result = await markLeaseSent({
      admin: auth.admin,
      tenantId: auth.session.tenantId,
      leaseId,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, status: result.status });
  }

  const result = await acknowledgeLeaseParty({
    admin: auth.admin,
    tenantId: auth.session.tenantId,
    leaseId,
    party: "landlord",
    acknowledgedBy: auth.session.authUserId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, status: result.status });
}
