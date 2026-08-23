import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { reviewTerminationRequest } from "@/utils/termination-request-review";

type TerminationRequestBody = {
  tenant_id?: string;
  lease_id?: string;
  action?: "approve" | "reject";
};

/**
 * Staff approve/reject of a tenant-submitted early termination request.
 * Approve calls terminateLeaseEarly (same effect as Terminate Lease Early).
 */
export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: TerminationRequestBody;
  try {
    body = (await request.json()) as TerminationRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const leaseId = body.lease_id?.trim() ?? "";
  const action = body.action;
  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      { error: "action must be approve or reject." },
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

  const result = await reviewTerminationRequest(admin, {
    tenantId: landlord.tenantId,
    leaseId,
    action,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (result.action === "reject") {
    return NextResponse.json({ success: true, action: "reject" });
  }

  return NextResponse.json({
    success: true,
    action: "approve",
    deposit_id: result.depositId,
    portal_revoked: result.portalRevoked ?? false,
    portal_email_sent: result.portalEmailSent ?? false,
    portal_revoke_error: result.portalRevokeError ?? null,
  });
}
