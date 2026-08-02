import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { processMaintenanceLandlordDecision } from "@/utils/maintenance-landlord-decision";

type DecisionBody = {
  request_id?: string;
  decision?: "approve" | "reject";
  /** Required confirmation for self-fix approve (mirrors staff proposed cost). */
  confirmed_cost_ghs?: number | string | null;
};

/**
 * Platform-only landlord approve/reject for own tenant_id maintenance requests.
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

  const requestId = body.request_id?.trim() ?? "";
  const decision = body.decision;
  if (!requestId) {
    return NextResponse.json(
      { error: "request_id is required" },
      { status: 400 },
    );
  }
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json(
      { error: "decision must be approve or reject." },
      { status: 400 },
    );
  }

  let confirmedCostGhs: number | null | undefined;
  if (body.confirmed_cost_ghs !== undefined && body.confirmed_cost_ghs !== null) {
    const parsed = Number(body.confirmed_cost_ghs);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json(
        { error: "confirmed_cost_ghs must be a non-negative number." },
        { status: 400 },
      );
    }
    confirmedCostGhs = parsed;
  }

  // Self-fix approve requires an explicit confirmed cost (enter/confirm).
  if (decision === "approve") {
    const { data: existing } = await auth.admin
      .from("maintenance_requests")
      .select("tenant_self_fix")
      .eq("tenant_id", auth.session.tenantId)
      .eq("request_id", requestId)
      .maybeSingle();
    if (existing?.tenant_self_fix && confirmedCostGhs == null) {
      return NextResponse.json(
        {
          error:
            "confirmed_cost_ghs is required to approve a self-fix request.",
        },
        { status: 400 },
      );
    }
  }

  const result = await processMaintenanceLandlordDecision(auth.admin, {
    tenantId: auth.session.tenantId,
    requestId,
    decision,
    applyEscrowOnApprove: false,
    confirmedCostGhs,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (result.landlordApprovalStatus === "rejected") {
    return NextResponse.json({
      success: true,
      landlord_approval_status: "rejected",
    });
  }

  if (result.selfFix) {
    return NextResponse.json({
      success: true,
      landlord_approval_status: "approved",
      self_fix: true,
      rent_credit_entry_id: result.rentCreditEntryId,
      credit_ghs: result.creditGhs,
    });
  }

  return NextResponse.json({
    success: true,
    landlord_approval_status: "approved",
  });
}
