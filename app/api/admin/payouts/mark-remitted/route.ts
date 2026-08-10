import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import {
  formatPayoutPeriod,
  roundPayoutMoney,
} from "@/app/dashboard/real-estate/payouts-utils";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

type MarkRemittedBody = {
  tenant_id?: string;
  payout_id?: string;
  remittance_reference?: string;
};

const MANAGEMENT_FEE_INCOME_CATEGORY = "Real Estate Management Fee";

function buildManagementFeeInvoiceNo(payoutId: string): string {
  return `RE-MGMT-FEE-${payoutId}`;
}

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
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

  const [{ data: payout, error: payoutError }, { data: landlordRow, error: landlordTypeError }] =
    await Promise.all([
      admin
        .from("landlord_payouts")
        .select(
          "payout_id, remittance_status, net_amount_ghs, management_fee_ghs, period_start, period_end",
        )
        .eq("tenant_id", landlord.tenantId)
        .eq("payout_id", payoutId)
        .maybeSingle(),
      admin
        .from("landlords")
        .select("landlord_type")
        .eq("tenant_id", landlord.tenantId)
        .maybeSingle(),
    ]);

  if (payoutError) {
    return NextResponse.json({ error: payoutError.message }, { status: 400 });
  }
  if (landlordTypeError) {
    return NextResponse.json(
      { error: landlordTypeError.message },
      { status: 400 },
    );
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
  const managementFeeGhs = roundPayoutMoney(
    Number(payout.management_fee_ghs) || 0,
  );
  const isDavorsManaged = landlordRow?.landlord_type === "davors_managed";
  const nowIso = new Date().toISOString();
  const remittanceDate = nowIso.slice(0, 10);

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

  // Davors' fee income — only for davors_managed remittances with a fee amount.
  // Idempotent via deterministic invoice_no so retries cannot double-post.
  if (isDavorsManaged && managementFeeGhs > 0) {
    const invoiceNo = buildManagementFeeInvoiceNo(payoutId);
    const periodLabel = formatPayoutPeriod(
      payout.period_start,
      payout.period_end,
    );

    const { data: existingIncome, error: existingIncomeError } = await admin
      .from("income_register")
      .select("id")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("invoice_no", invoiceNo)
      .maybeSingle();

    if (existingIncomeError) {
      return NextResponse.json(
        {
          error: `Payout remitted, but failed to check Income Register: ${existingIncomeError.message}`,
        },
        { status: 400 },
      );
    }

    if (!existingIncome) {
      const description = `Real estate management fee — ${landlord.name} — payout period ${periodLabel} (payout ${payoutId})`;

      const { error: incomeError } = await admin.from("income_register").insert({
        tenant_id: DAVORS_TENANT_ID,
        date: remittanceDate,
        due_date: remittanceDate,
        invoice_no: invoiceNo,
        customer_name: landlord.name,
        client_id: null,
        entry_type: "service",
        service_category: MANAGEMENT_FEE_INCOME_CATEGORY,
        description,
        amount: managementFeeGhs,
        amount_received: managementFeeGhs,
        outstanding_balance: 0,
        payment_status: "Paid",
        notes: `Auto-posted from Real Estate payout remittance. Landlord tenant_id=${landlord.tenantId}; remittance ref=${remittanceReference}.`,
        tax_inclusive: true,
        net_of_tax_amount: managementFeeGhs,
        output_vat_amount: 0,
        output_tax_component: null,
        wht_rate: null,
        wht_amount: 0,
        sale_status: "active",
        is_system_adjustment: false,
      });

      if (incomeError) {
        return NextResponse.json(
          {
            error: `Payout remitted, but failed to post management fee to Income Register: ${incomeError.message}`,
          },
          { status: 400 },
        );
      }
    }
  }

  return NextResponse.json({
    success: true,
    escrow_balance_after_ghs: balanceAfter,
  });
}
