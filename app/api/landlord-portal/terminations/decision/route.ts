import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { reviewTerminationRequest } from "@/utils/termination-request-review";

type DecisionBody = {
  lease_id?: string;
  action?: "approve" | "reject";
};

/**
 * Platform-only landlord approve/reject of early termination for own leases.
 * Approve uses terminateLeaseEarly via reviewTerminationRequest.
 * Mutations use service role after session + landlord_type checks (RLS is SELECT-only).
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: DecisionBody;
  try {
    body = (await request.json()) as DecisionBody;
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

  const result = await reviewTerminationRequest(auth.admin, {
    tenantId: auth.session.tenantId,
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
