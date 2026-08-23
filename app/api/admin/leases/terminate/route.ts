import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { terminateLeaseEarly } from "@/utils/lease-management";

type TerminateLeaseBody = {
  tenant_id?: string;
  lease_id?: string;
  termination_reason?: string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: TerminateLeaseBody;
  try {
    body = (await request.json()) as TerminateLeaseBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const leaseId = body.lease_id?.trim() ?? "";
  const terminationReason = body.termination_reason?.trim() ?? "";
  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }
  if (!terminationReason) {
    return NextResponse.json(
      { error: "termination_reason is required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const landlord = await assertRealEstateLandlordTenant(
    admin,
    body.tenant_id ?? "",
  );
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  try {
    const result = await terminateLeaseEarly(admin, {
      tenantId: landlord.tenantId,
      leaseId,
      terminationReason,
    });

    return NextResponse.json({
      success: true,
      deposit_id: result.depositId,
      portal_revoked: result.portalRevoked,
      portal_email_sent: result.portalEmailSent,
      portal_revoke_error: result.portalRevokeError ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to terminate lease.";
    const status =
      message === "Lease not found."
        ? 404
        : message.includes("Only active")
          ? 400
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
