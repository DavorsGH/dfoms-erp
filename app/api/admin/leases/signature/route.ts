import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import {
  acknowledgeLeaseParty,
  markLeaseSent,
} from "@/utils/lease-signature";

export const runtime = "nodejs";

type SignatureBody = {
  tenant_id?: string;
  lease_id?: string;
  action?: string;
};

/**
 * Staff: mark lease sent or record landlord/tenant acknowledgment.
 */
export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
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
  if (
    action !== "mark_sent" &&
    action !== "acknowledge_landlord" &&
    action !== "acknowledge_tenant"
  ) {
    return NextResponse.json(
      {
        error:
          "action must be mark_sent, acknowledge_landlord, or acknowledge_tenant",
      },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const landlord = await assertRealEstateLandlordTenant(
    admin,
    body.tenant_id ?? "",
  );
  if (!landlord.ok) {
    return NextResponse.json({ error: landlord.error }, { status: 400 });
  }

  if (action === "mark_sent") {
    const result = await markLeaseSent({
      admin,
      tenantId: landlord.tenantId,
      leaseId,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, status: result.status });
  }

  const party =
    action === "acknowledge_landlord" ? ("landlord" as const) : ("tenant" as const);
  const result = await acknowledgeLeaseParty({
    admin,
    tenantId: landlord.tenantId,
    leaseId,
    party,
    acknowledgedBy: auth.userId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, status: result.status });
}
