import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
import { processMaintenanceLandlordDecision } from "@/utils/maintenance-landlord-decision";

type DecisionBody = {
  tenant_id?: string;
  request_id?: string;
  decision?: "approve" | "reject";
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
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

  const admin = createAdminClient();
  const landlord = await assertDavorsManagedLandlord(admin, body.tenant_id ?? "");
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const result = await processMaintenanceLandlordDecision(admin, {
    tenantId: landlord.tenantId,
    requestId,
    decision,
    applyEscrowOnApprove: true,
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
    escrow_balance_after_ghs: result.escrowBalanceAfterGhs,
  });
}
