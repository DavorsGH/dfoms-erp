import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { fetchLandlordTypeForTenant } from "@/utils/rent-ledger-management";
import {
  formatRentPaymentMethod,
  isManualPaymentMethod,
  isRentLedgerStatus,
  resolveManualPaymentVerificationStatus,
  resolveRentStatusAfterPayment,
  type RentLedgerStatus,
} from "@/app/dashboard/real-estate/rent-ledger-utils";
import { voidNotifyRentPaymentSuccess } from "@/utils/real-estate-document-notifications";

type RecordPaymentBody = {
  tenant_id?: string;
  entry_id?: string;
  amount_paid_ghs?: number | string;
  payment_method?: string;
  payment_date?: string;
  notes?: string | null;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: RecordPaymentBody;
  try {
    body = (await request.json()) as RecordPaymentBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const entryId = body.entry_id?.trim() ?? "";
  if (!entryId) {
    return NextResponse.json({ error: "entry_id is required" }, { status: 400 });
  }

  const paymentMethod = body.payment_method?.trim() ?? "";
  if (!isManualPaymentMethod(paymentMethod)) {
    return NextResponse.json(
      { error: "payment_method must be cash or bank_transfer." },
      { status: 400 },
    );
  }

  const paymentDate = body.payment_date?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    return NextResponse.json(
      { error: "payment_date must be YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const paymentAmount = Number(body.amount_paid_ghs);
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return NextResponse.json(
      { error: "amount_paid_ghs must be a positive number." },
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

  const { landlordType, fetchError: landlordTypeError } =
    await fetchLandlordTypeForTenant(admin, landlord.tenantId);
  if (landlordTypeError || !landlordType) {
    return NextResponse.json(
      { error: landlordTypeError ?? "Landlord type not configured." },
      { status: 400 },
    );
  }

  const { data: entry, error: entryError } = await admin
    .from("rent_ledger")
    .select(
      "entry_id, lease_id, period_start, period_end, amount_due_ghs, amount_paid_ghs, credit_ghs, status, notes, verification_status",
    )
    .eq("tenant_id", landlord.tenantId)
    .eq("entry_id", entryId)
    .maybeSingle();

  if (entryError) {
    return NextResponse.json({ error: entryError.message }, { status: 400 });
  }
  if (!entry) {
    return NextResponse.json(
      { error: "Rent ledger entry not found." },
      { status: 404 },
    );
  }

  if (!isRentLedgerStatus(entry.status)) {
    return NextResponse.json(
      { error: "Invalid rent ledger status." },
      { status: 400 },
    );
  }
  if (entry.status === "paid") {
    return NextResponse.json(
      { error: "This entry is already fully paid." },
      { status: 400 },
    );
  }

  const amountDue = roundMoney(Number(entry.amount_due_ghs) || 0);
  const existingPaid = roundMoney(Number(entry.amount_paid_ghs) || 0);
  const creditGhs = roundMoney(Number(entry.credit_ghs) || 0);
  const nextPaid = roundMoney(existingPaid + paymentAmount);
  const nextStatus = resolveRentStatusAfterPayment(
    amountDue,
    nextPaid,
    entry.status as RentLedgerStatus,
    creditGhs,
  );
  const verificationStatus =
    resolveManualPaymentVerificationStatus(landlordType);

  const noteTrimmed = body.notes?.trim() || "";
  const existingNotes = (entry.notes as string | null)?.trim() || "";
  const paymentNote = `Payment ${paymentAmount.toFixed(2)} via ${paymentMethod} on ${paymentDate}.`;
  const nextNotes = [existingNotes, noteTrimmed, paymentNote]
    .filter(Boolean)
    .join("\n");

  const paymentDateIso = `${paymentDate}T12:00:00.000Z`;
  const nowIso = new Date().toISOString();

  const { error: updateError } = await admin
    .from("rent_ledger")
    .update({
      amount_paid_ghs: nextPaid,
      payment_method: paymentMethod,
      payment_date: paymentDateIso,
      status: nextStatus,
      verification_status: verificationStatus,
      notes: nextNotes || null,
      updated_at: nowIso,
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("entry_id", entryId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  const leaseId = (entry.lease_id as string | null)?.trim() ?? "";
  if (leaseId) {
    const { data: lease } = await admin
      .from("leases")
      .select("lessee_id")
      .eq("tenant_id", landlord.tenantId)
      .eq("lease_id", leaseId)
      .maybeSingle();

    const lesseeId = (lease?.lessee_id as string | null)?.trim() ?? "";
    if (lesseeId) {
      voidNotifyRentPaymentSuccess({
        tenantId: landlord.tenantId,
        landlordType,
        amountGhs: paymentAmount,
        periodStart: entry.period_start as string,
        periodEnd: entry.period_end as string,
        paymentMethod: formatRentPaymentMethod(paymentMethod),
        lesseeId,
        primaryEntryId: entryId,
        notifyStaff: true,
      });
    }
  }

  return NextResponse.json({
    success: true,
    amount_paid_ghs: nextPaid,
    status: nextStatus,
    verification_status: verificationStatus,
  });
}
