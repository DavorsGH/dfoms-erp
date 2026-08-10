import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  fetchLandlordPayoutContext,
  fetchRentPaymentsInPeriod,
  sumPaymentAmounts,
} from "@/utils/payout-management";
import { roundPayoutMoney } from "@/app/dashboard/real-estate/payouts-utils";

type GeneratePayoutBody = {
  tenant_id?: string;
  period_start?: string;
  period_end?: string;
};

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: GeneratePayoutBody;
  try {
    body = (await request.json()) as GeneratePayoutBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const periodStart = body.period_start?.trim() ?? "";
  const periodEnd = body.period_end?.trim() ?? "";
  if (!isDateOnly(periodStart) || !isDateOnly(periodEnd)) {
    return NextResponse.json(
      { error: "period_start and period_end must be YYYY-MM-DD." },
      { status: 400 },
    );
  }
  if (periodEnd < periodStart) {
    return NextResponse.json(
      { error: "period_end must be on or after period_start." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { context, fetchError: contextError } =
    await fetchLandlordPayoutContext(admin, body.tenant_id ?? "");
  if (contextError) {
    return NextResponse.json({ error: contextError }, { status: 400 });
  }
  if (!context) {
    return NextResponse.json(
      { error: "Landlord tenant not found." },
      { status: 404 },
    );
  }
  if (
    context.landlordType !== "platform_only" &&
    context.landlordType !== "davors_managed"
  ) {
    return NextResponse.json(
      { error: "Landlord type must be set before generating payouts." },
      { status: 400 },
    );
  }

  const { data: existing, error: existingError } = await admin
    .from("landlord_payouts")
    .select("payout_id")
    .eq("tenant_id", context.tenantId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (existing) {
    return NextResponse.json(
      { error: "A payout/statement already exists for this period." },
      { status: 400 },
    );
  }

  const { payments, fetchError: paymentsError } =
    await fetchRentPaymentsInPeriod(
      admin,
      context.tenantId,
      periodStart,
      periodEnd,
    );
  if (paymentsError) {
    return NextResponse.json({ error: paymentsError }, { status: 400 });
  }

  // Paystack portal collections already write escrow_ledger rows. Deduct those
  // amounts so payout generate does not double-count into escrow.
  const paymentEntryIds = payments.map((payment) => payment.entry_id);
  const alreadyEscrowedByEntry = new Map<string, number>();
  if (paymentEntryIds.length > 0 && context.landlordType === "davors_managed") {
    const { data: existingCollections, error: existingEscrowError } =
      await admin
        .from("escrow_ledger")
        .select("related_rent_ledger_id, amount_ghs")
        .eq("tenant_id", context.tenantId)
        .eq("entry_type", "collection")
        .in("related_rent_ledger_id", paymentEntryIds);

    if (existingEscrowError) {
      return NextResponse.json(
        { error: existingEscrowError.message },
        { status: 400 },
      );
    }

    for (const row of (existingCollections as Array<{
      related_rent_ledger_id: string | null;
      amount_ghs: number | string;
    }> | null) ?? []) {
      const relatedId = row.related_rent_ledger_id;
      if (!relatedId) {
        continue;
      }
      const prior = alreadyEscrowedByEntry.get(relatedId) ?? 0;
      alreadyEscrowedByEntry.set(
        relatedId,
        roundPayoutMoney(prior + (Number(row.amount_ghs) || 0)),
      );
    }
  }

  const paymentsNeedingEscrow = payments
    .map((payment) => {
      const paid = roundPayoutMoney(Number(payment.amount_paid_ghs) || 0);
      const already = alreadyEscrowedByEntry.get(payment.entry_id) ?? 0;
      const remaining = roundPayoutMoney(Math.max(0, paid - already));
      return {
        ...payment,
        amount_paid_ghs: remaining,
      };
    })
    .filter((payment) => Number(payment.amount_paid_ghs) > 0);

  // Gross for the statement still reflects all rent paid in the period.
  const grossAmountGhs = sumPaymentAmounts(payments);
  if (grossAmountGhs <= 0) {
    return NextResponse.json(
      { error: "No rent payments found in the selected period." },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();
  const payoutId = crypto.randomUUID();

  if (context.landlordType === "platform_only") {
    const { error: insertError } = await admin.from("landlord_payouts").insert({
      tenant_id: context.tenantId,
      payout_id: payoutId,
      period_start: periodStart,
      period_end: periodEnd,
      gross_amount_ghs: grossAmountGhs,
      management_fee_ghs: null,
      net_amount_ghs: grossAmountGhs,
      paystack_reference: null,
      remittance_status: "remitted",
      remittance_date: `${periodEnd}T12:00:00.000Z`,
      remittance_reference: null,
      created_at: nowIso,
      updated_at: nowIso,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      payout_id: payoutId,
      gross_amount_ghs: grossAmountGhs,
      management_fee_ghs: null,
      net_amount_ghs: grossAmountGhs,
    });
  }

  // davors_managed — fee rate always from this landlord's current record.
  const feePercent = context.managementFeePercent;
  if (feePercent == null || feePercent < 0) {
    return NextResponse.json(
      {
        error:
          "management_fee_percent must be set on this Davors-managed landlord before generating a payout.",
      },
      { status: 400 },
    );
  }

  const managementFeeGhs = roundPayoutMoney(
    (grossAmountGhs * feePercent) / 100,
  );
  const netAmountGhs = roundPayoutMoney(grossAmountGhs - managementFeeGhs);

  const { data: latestEscrow, error: escrowBalanceError } = await admin
    .from("escrow_ledger")
    .select("balance_after_ghs, entry_date, created_at")
    .eq("tenant_id", context.tenantId)
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

  let runningBalance = Number(latestEscrow?.balance_after_ghs) || 0;

  const { error: payoutInsertError } = await admin
    .from("landlord_payouts")
    .insert({
      tenant_id: context.tenantId,
      payout_id: payoutId,
      period_start: periodStart,
      period_end: periodEnd,
      gross_amount_ghs: grossAmountGhs,
      management_fee_ghs: managementFeeGhs,
      net_amount_ghs: netAmountGhs,
      paystack_reference: null,
      remittance_status: "pending",
      remittance_date: null,
      remittance_reference: null,
      created_at: nowIso,
      updated_at: nowIso,
    });

  if (payoutInsertError) {
    return NextResponse.json(
      { error: payoutInsertError.message },
      { status: 400 },
    );
  }

  const escrowRows: Array<{
    tenant_id: string;
    entry_id: string;
    entry_type: "collection" | "fee_deduction";
    amount_ghs: number;
    related_rent_ledger_id: string | null;
    balance_after_ghs: number;
    entry_date: string;
    created_at: string;
  }> = [];

  for (const payment of paymentsNeedingEscrow) {
    const amount = roundPayoutMoney(Number(payment.amount_paid_ghs) || 0);
    runningBalance = roundPayoutMoney(runningBalance + amount);
    escrowRows.push({
      tenant_id: context.tenantId,
      entry_id: crypto.randomUUID(),
      entry_type: "collection",
      amount_ghs: amount,
      related_rent_ledger_id: payment.entry_id,
      balance_after_ghs: runningBalance,
      entry_date: payment.payment_date,
      created_at: nowIso,
    });
  }

  runningBalance = roundPayoutMoney(runningBalance - managementFeeGhs);
  escrowRows.push({
    tenant_id: context.tenantId,
    entry_id: crypto.randomUUID(),
    entry_type: "fee_deduction",
    amount_ghs: managementFeeGhs,
    related_rent_ledger_id: null,
    balance_after_ghs: runningBalance,
    entry_date: nowIso,
    created_at: nowIso,
  });

  const { error: escrowInsertError } = await admin
    .from("escrow_ledger")
    .insert(escrowRows);

  if (escrowInsertError) {
    return NextResponse.json(
      { error: escrowInsertError.message },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    payout_id: payoutId,
    gross_amount_ghs: grossAmountGhs,
    management_fee_ghs: managementFeeGhs,
    management_fee_percent: feePercent,
    net_amount_ghs: netAmountGhs,
    escrow_balance_after_ghs: runningBalance,
  });
}
