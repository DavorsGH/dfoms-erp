import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { roundPayoutMoney } from "@/app/dashboard/real-estate/payouts-utils";

type MarkRemittedBody = {
  tenant_id?: string;
  payout_id?: string;
  remittance_reference?: string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: MarkRemittedBody;
  try {
    body = (await request.json()) as MarkRemittedBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const payoutId = body.payout_id?.trim() ?? "";
  const remittanceReference = body.remittance_reference?.trim() ?? "";
  if (!payoutId) {
    return NextResponse.json({ error: "payout_id is required" }, { status: 400 });
  }
  if (!remittanceReference) {
    return NextResponse.json(
      { error: "remittance_reference is required" },
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

  const { data: payout, error: payoutError } = await admin
    .from("landlord_payouts")
    .select(
      "payout_id, remittance_status, net_amount_ghs, management_fee_ghs",
    )
    .eq("tenant_id", landlord.tenantId)
    .eq("payout_id", payoutId)
    .maybeSingle();

  if (payoutError) {
    return NextResponse.json({ error: payoutError.message }, { status: 400 });
  }
  if (!payout) {
    return NextResponse.json({ error: "Payout not found." }, { status: 404 });
  }
  if (payout.remittance_status !== "pending") {
    return NextResponse.json(
      { error: "Only pending payouts can be marked as remitted." },
      { status: 400 },
    );
  }

  const netAmount = roundPayoutMoney(Number(payout.net_amount_ghs) || 0);
  const nowIso = new Date().toISOString();

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
  const balanceAfter = roundPayoutMoney(previousBalance - netAmount);

  const { error: updateError } = await admin
    .from("landlord_payouts")
    .update({
      remittance_status: "remitted",
      remittance_date: nowIso,
      remittance_reference: remittanceReference,
      updated_at: nowIso,
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("payout_id", payoutId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  const { error: escrowError } = await admin.from("escrow_ledger").insert({
    tenant_id: landlord.tenantId,
    entry_id: crypto.randomUUID(),
    entry_type: "remittance",
    amount_ghs: netAmount,
    related_rent_ledger_id: null,
    balance_after_ghs: balanceAfter,
    entry_date: nowIso,
    created_at: nowIso,
  });

  if (escrowError) {
    return NextResponse.json({ error: escrowError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    escrow_balance_after_ghs: balanceAfter,
  });
}
