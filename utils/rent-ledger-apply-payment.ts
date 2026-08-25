import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
import {
  isRentLedgerStatus,
  resolveManualPaymentVerificationStatus,
  resolveRentStatusAfterPayment,
  type RentLedgerStatus,
} from "@/app/dashboard/real-estate/rent-ledger-utils";
import { formatRentPaymentMethod } from "@/app/dashboard/real-estate/rent-ledger-utils";
import { voidNotifyRentPaymentSuccess } from "@/utils/real-estate-document-notifications";

export type ApplyRentLedgerPaymentInput = {
  tenantId: string;
  entryId: string;
  paymentAmountGhs: number;
  /** cash | bank_transfer for staff manual; FM collections may pass momo (stored in notes). */
  paymentMethod: string;
  paymentDate: string;
  notes?: string | null;
  landlordType: LandlordType;
  /** Prefix for auto-generated payment note line. */
  notePrefix?: string;
};

export type ApplyRentLedgerPaymentResult =
  | {
      ok: true;
      amountPaidGhs: number;
      status: RentLedgerStatus;
      verificationStatus: string;
    }
  | { ok: false; error: string; status: number };

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Map FM collection methods to rent_ledger payment_method (text column). */
export function mapCollectionMethodToLedgerPaymentMethod(
  method: string,
): "cash" | "bank_transfer" {
  if (method === "cash") {
    return "cash";
  }
  return "bank_transfer";
}

/**
 * Apply a manual payment increment to a rent_ledger row.
 * Shared by staff record-payment and landlord FM collection confirm.
 */
export async function applyRentLedgerPayment(
  admin: SupabaseClient,
  input: ApplyRentLedgerPaymentInput,
): Promise<ApplyRentLedgerPaymentResult> {
  const entryId = input.entryId.trim();
  if (!entryId) {
    return { ok: false, error: "entry_id is required", status: 400 };
  }

  const paymentDate = input.paymentDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    return {
      ok: false,
      error: "payment_date must be YYYY-MM-DD.",
      status: 400,
    };
  }

  const paymentAmount = roundMoney(input.paymentAmountGhs);
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return {
      ok: false,
      error: "Payment amount must be a positive number.",
      status: 400,
    };
  }

  const ledgerPaymentMethod = mapCollectionMethodToLedgerPaymentMethod(
    input.paymentMethod,
  );

  const { data: entry, error: entryError } = await admin
    .from("rent_ledger")
    .select(
      "entry_id, lease_id, period_start, period_end, amount_due_ghs, amount_paid_ghs, credit_ghs, status, notes, verification_status",
    )
    .eq("tenant_id", input.tenantId)
    .eq("entry_id", entryId)
    .maybeSingle();

  if (entryError) {
    return { ok: false, error: entryError.message, status: 400 };
  }
  if (!entry) {
    return { ok: false, error: "Rent ledger entry not found.", status: 404 };
  }

  if (!isRentLedgerStatus(entry.status)) {
    return { ok: false, error: "Invalid rent ledger status.", status: 400 };
  }
  if (entry.status === "paid") {
    return {
      ok: false,
      error: "This entry is already fully paid.",
      status: 400,
    };
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
  const verificationStatus = resolveManualPaymentVerificationStatus(
    input.landlordType,
  );

  const noteTrimmed = input.notes?.trim() || "";
  const existingNotes = (entry.notes as string | null)?.trim() || "";
  const methodLabel =
    input.paymentMethod === "momo"
      ? "momo"
      : ledgerPaymentMethod;
  const prefix = input.notePrefix?.trim() || "Payment";
  const paymentNote = `${prefix} ${paymentAmount.toFixed(2)} via ${methodLabel} on ${paymentDate}.`;
  const nextNotes = [existingNotes, noteTrimmed, paymentNote]
    .filter(Boolean)
    .join("\n");

  const paymentDateIso = `${paymentDate}T12:00:00.000Z`;
  const nowIso = new Date().toISOString();

  const { error: updateError } = await admin
    .from("rent_ledger")
    .update({
      amount_paid_ghs: nextPaid,
      payment_method: ledgerPaymentMethod,
      payment_date: paymentDateIso,
      status: nextStatus,
      verification_status: verificationStatus,
      notes: nextNotes || null,
      updated_at: nowIso,
    })
    .eq("tenant_id", input.tenantId)
    .eq("entry_id", entryId);

  if (updateError) {
    return { ok: false, error: updateError.message, status: 400 };
  }

  const leaseId = (entry.lease_id as string | null)?.trim() ?? "";
  if (leaseId) {
    const { data: lease } = await admin
      .from("leases")
      .select("lessee_id")
      .eq("tenant_id", input.tenantId)
      .eq("lease_id", leaseId)
      .maybeSingle();

    const lesseeId = (lease?.lessee_id as string | null)?.trim() ?? "";
    if (lesseeId) {
      voidNotifyRentPaymentSuccess({
        tenantId: input.tenantId,
        landlordType: input.landlordType,
        amountGhs: paymentAmount,
        periodStart: entry.period_start as string,
        periodEnd: entry.period_end as string,
        paymentMethod: formatRentPaymentMethod(
          input.paymentMethod === "momo" ? "bank_transfer" : ledgerPaymentMethod,
        ),
        lesseeId,
        primaryEntryId: entryId,
        notifyStaff: true,
      });
    }
  }

  return {
    ok: true,
    amountPaidGhs: nextPaid,
    status: nextStatus,
    verificationStatus,
  };
}
