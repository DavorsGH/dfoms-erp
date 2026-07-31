import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
import { roundPayoutMoney } from "@/app/dashboard/real-estate/payouts-utils";

type DecisionBody = {
  tenant_id?: string;
  request_id?: string;
  decision?: "approve" | "reject";
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
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

  const { data: existing, error: existingError } = await admin
    .from("maintenance_requests")
    .select(
      "request_id, cost_ghs, landlord_approval_status",
    )
    .eq("tenant_id", landlord.tenantId)
    .eq("request_id", requestId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Maintenance request not found." },
      { status: 404 },
    );
  }
  if (existing.landlord_approval_status !== "pending") {
    return NextResponse.json(
      {
        error:
          "Only requests with pending landlord approval can be approved or rejected.",
      },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();

  if (decision === "reject") {
    const { error: updateError } = await admin
      .from("maintenance_requests")
      .update({
        landlord_approval_status: "rejected",
        updated_at: nowIso,
      })
      .eq("tenant_id", landlord.tenantId)
      .eq("request_id", requestId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      landlord_approval_status: "rejected",
    });
  }

  const costGhs = Number(existing.cost_ghs);
  if (!Number.isFinite(costGhs) || costGhs < 0 || existing.cost_ghs == null) {
    return NextResponse.json(
      {
        error:
          "cost_ghs must be set before approving a maintenance request for escrow deduction.",
      },
      { status: 400 },
    );
  }

  const roundedCost = roundPayoutMoney(costGhs);

  const { data: latestEscrow, error: escrowBalanceError } = await admin
    .from("escrow_ledger")
    .select("balance_after_ghs, entry_date, created_at")
    .eq("tenant_id", landlord.tenantId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (escrowBalanceError) {
    return NextResponse.json(
      { error: escrowBalanceError.message },
      { status: 400 },
    );
  }

  const previousBalance = Number(latestEscrow?.balance_after_ghs) || 0;
  const balanceAfter = roundPayoutMoney(previousBalance - roundedCost);

  const { error: updateError } = await admin
    .from("maintenance_requests")
    .update({
      landlord_approval_status: "approved",
      updated_at: nowIso,
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("request_id", requestId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  const { error: escrowError } = await admin.from("escrow_ledger").insert({
    tenant_id: landlord.tenantId,
    entry_id: crypto.randomUUID(),
    entry_type: "fee_deduction",
    amount_ghs: roundedCost,
    related_rent_ledger_id: null,
    balance_after_ghs: balanceAfter,
    entry_date: nowIso,
    created_at: nowIso,
  });

  if (escrowError) {
    // Approval already saved; surface escrow failure clearly.
    return NextResponse.json(
      {
        error: `Landlord approval saved, but escrow deduction failed: ${escrowError.message}`,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    landlord_approval_status: "approved",
    escrow_balance_after_ghs: balanceAfter,
  });
}
