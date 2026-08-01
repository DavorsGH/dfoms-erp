import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";
import { sendResendEmail } from "@/utils/resend-email";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import { normalizeGhanaPhone } from "@/utils/product-sale-paystack";
import { fetchEscrowBalanceForLandlord } from "@/utils/payout-management";
import { roundPayoutMoney } from "@/app/dashboard/real-estate/payouts-utils";
import {
  formatRentMoney,
  formatRentPeriod,
  resolvePaystackPaymentVerificationStatus,
  resolveRentStatusAfterPayment,
  type RentLedgerStatus,
  type RentVerificationStatus,
} from "@/app/dashboard/real-estate/rent-ledger-utils";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";

export const RENT_LEDGER_PAYSTACK_CONTEXT = "rent_ledger" as const;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataObject(data: JsonRecord): JsonRecord {
  let meta: JsonRecord | null = null;
  const raw = data.metadata;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      try {
        meta = asRecord(JSON.parse(trimmed));
      } catch {
        meta = null;
      }
    }
  } else {
    meta = asRecord(raw);
  }

  return meta ?? {};
}

function roundGhs(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function paystackAppliedMarker(reference: string): string {
  return `[paystack:${reference.trim()}]`;
}

/**
 * Paystack Inline (webhook/verify confirmed) is gateway-trusted.
 * Unlike manual cash/bank_transfer on davors_managed (pending_verification),
 * Paystack-confirmed rent never needs the staff Verify step → not_required.
 */
export function resolvePaystackRentVerificationStatus(): RentVerificationStatus {
  return resolvePaystackPaymentVerificationStatus();
}

export function paymentMethodLabelFromPaystackChannel(
  channel: string | null | undefined,
): string {
  const normalized = (channel ?? "").trim().toLowerCase();
  if (normalized === "mobile_money" || normalized === "mobile money") {
    return "Paystack Mobile Money";
  }
  if (normalized === "card") {
    return "Paystack Card";
  }
  if (normalized) {
    return `Paystack ${normalized.replace(/_/g, " ")}`;
  }
  return "Paystack";
}

export function isRentLedgerPaystackContext(data: JsonRecord): boolean {
  const meta = metadataObject(data);
  return asString(meta.context) === RENT_LEDGER_PAYSTACK_CONTEXT;
}

export type FulfillRentPaystackResult = {
  alreadyFulfilled: boolean;
  entryId: string;
  amountPaidGhs: number;
  status: RentLedgerStatus;
  verificationStatus: RentVerificationStatus;
  escrowBalanceAfterGhs: number | null;
};

type RentEntryRow = {
  entry_id: string;
  tenant_id: string;
  lease_id: string;
  period_start: string;
  period_end: string;
  amount_due_ghs: number | string;
  amount_paid_ghs: number | string;
  status: string;
  payment_method: string | null;
  payment_date: string | null;
  verification_status: string | null;
  paystack_reference: string | null;
  notes: string | null;
};

async function loadRentEntry(
  admin: SupabaseClient,
  options: {
    entryId?: string | null;
    reference?: string | null;
    tenantId?: string | null;
  },
): Promise<RentEntryRow | null> {
  if (options.entryId) {
    let query = admin
      .from("rent_ledger")
      .select(
        "entry_id, tenant_id, lease_id, period_start, period_end, amount_due_ghs, amount_paid_ghs, status, payment_method, payment_date, verification_status, paystack_reference, notes",
      )
      .eq("entry_id", options.entryId);
    if (options.tenantId) {
      query = query.eq("tenant_id", options.tenantId);
    }
    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    return (data as RentEntryRow | null) ?? null;
  }

  if (options.reference) {
    let query = admin
      .from("rent_ledger")
      .select(
        "entry_id, tenant_id, lease_id, period_start, period_end, amount_due_ghs, amount_paid_ghs, status, payment_method, payment_date, verification_status, paystack_reference, notes",
      )
      .eq("paystack_reference", options.reference)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (options.tenantId) {
      query = query.eq("tenant_id", options.tenantId);
    }
    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    return (data as RentEntryRow | null) ?? null;
  }

  return null;
}

async function insertEscrowCollection(options: {
  admin: SupabaseClient;
  tenantId: string;
  rentEntryId: string;
  amountGhs: number;
  entryDate: string;
}): Promise<number> {
  const amount = roundPayoutMoney(options.amountGhs);
  if (amount <= 0) {
    const { balanceGhs } = await fetchEscrowBalanceForLandlord(
      options.admin,
      options.tenantId,
    );
    return balanceGhs;
  }

  // Guard confirm+webhook races: skip if a matching collection already exists.
  const { data: existingRows } = await options.admin
    .from("escrow_ledger")
    .select("entry_id, amount_ghs, balance_after_ghs")
    .eq("tenant_id", options.tenantId)
    .eq("related_rent_ledger_id", options.rentEntryId)
    .eq("entry_type", "collection");

  const matching = (
    (existingRows as Array<{
      entry_id: string;
      amount_ghs: number | string;
      balance_after_ghs: number | string;
    }> | null) ?? []
  ).find((row) => roundPayoutMoney(Number(row.amount_ghs) || 0) === amount);

  if (matching) {
    return roundPayoutMoney(Number(matching.balance_after_ghs) || 0);
  }

  const { data: latestEscrow, error: balanceError } = await options.admin
    .from("escrow_ledger")
    .select("balance_after_ghs, entry_date, created_at")
    .eq("tenant_id", options.tenantId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (balanceError) {
    throw new Error(balanceError.message);
  }

  const previousBalance = Number(latestEscrow?.balance_after_ghs) || 0;
  const balanceAfter = roundPayoutMoney(previousBalance + amount);
  const nowIso = new Date().toISOString();

  const { error: insertError } = await options.admin.from("escrow_ledger").insert({
    tenant_id: options.tenantId,
    entry_id: crypto.randomUUID(),
    entry_type: "collection",
    amount_ghs: amount,
    related_rent_ledger_id: options.rentEntryId,
    balance_after_ghs: balanceAfter,
    entry_date: options.entryDate,
    created_at: nowIso,
  });

  if (insertError) {
    throw new Error(insertError.message);
  }

  return balanceAfter;
}

async function notifyRentPaystackSuccess(options: {
  tenantId: string;
  landlordType: LandlordType;
  amountGhs: number;
  periodStart: string;
  periodEnd: string;
  paymentMethod: string;
  escrowBalanceAfterGhs: number | null;
  lesseeId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const periodLabel = formatRentPeriod(options.periodStart, options.periodEnd);
  const amountLabel = formatRentMoney(options.amountGhs);

  const [{ data: lessee }, { data: landlordTenant }] = await Promise.all([
    admin
      .from("lessees")
      .select("full_name, email, phone")
      .eq("tenant_id", options.tenantId)
      .eq("lessee_id", options.lesseeId)
      .maybeSingle(),
    admin
      .from("tenants")
      .select("name, email, phone")
      .eq("id", options.tenantId)
      .maybeSingle(),
  ]);

  const lesseeName = lessee?.full_name?.trim() || "Tenant";
  const landlordName = landlordTenant?.name?.trim() || "Landlord";

  // 1) Tenant receipt
  const tenantSubject = `Rent payment receipt — ${periodLabel}`;
  const tenantText = [
    `Hi ${lesseeName},`,
    "",
    `We received your rent payment of ${amountLabel}.`,
    `Period: ${periodLabel}`,
    `Method: ${options.paymentMethod}`,
    "",
    "Thank you.",
    "Davors Facilities",
  ].join("\n");
  const tenantHtml = `<p>Hi ${escapeHtml(lesseeName)},</p>
<p>We received your rent payment of <strong>${escapeHtml(amountLabel)}</strong>.</p>
<p>Period: ${escapeHtml(periodLabel)}<br/>Method: ${escapeHtml(options.paymentMethod)}</p>
<p>Thank you.<br/>Davors Facilities</p>`;

  const lesseeEmail = asString(lessee?.email);
  if (lesseeEmail) {
    const emailResult = await sendResendEmail({
      to: lesseeEmail,
      subject: tenantSubject,
      html: tenantHtml,
      text: tenantText,
    });
    if (!emailResult.ok) {
      console.error(
        "[rent-ledger-paystack] tenant receipt email failed:",
        emailResult.error,
      );
    }
  }

  const lesseePhone = normalizeGhanaPhone(lessee?.phone);
  if (lesseePhone) {
    const smsResult = await sendHubtelSms({
      to: lesseePhone,
      content: `Davors: Rent payment of ${amountLabel} received for ${periodLabel} via ${options.paymentMethod}. Thank you.`,
    });
    if (!smsResult.ok) {
      console.error(
        "[rent-ledger-paystack] tenant receipt SMS failed:",
        smsResult.error,
      );
    }
  }

  // 2) Landlord "rent received"
  const escrowLine =
    options.landlordType === "davors_managed" &&
    options.escrowBalanceAfterGhs != null
      ? `Updated escrow balance: ${formatRentMoney(options.escrowBalanceAfterGhs)}.`
      : null;

  const landlordSubject = `Rent received — ${lesseeName}`;
  const landlordText = [
    `Hi ${landlordName},`,
    "",
    `Rent of ${amountLabel} was received from ${lesseeName}.`,
    `Period: ${periodLabel}`,
    `Method: ${options.paymentMethod}`,
    escrowLine,
    "",
    "Davors Facilities",
  ]
    .filter(Boolean)
    .join("\n");
  const landlordHtml = `<p>Hi ${escapeHtml(landlordName)},</p>
<p>Rent of <strong>${escapeHtml(amountLabel)}</strong> was received from ${escapeHtml(lesseeName)}.</p>
<p>Period: ${escapeHtml(periodLabel)}<br/>Method: ${escapeHtml(options.paymentMethod)}${
    escrowLine ? `<br/>${escapeHtml(escrowLine)}` : ""
  }</p>
<p>Davors Facilities</p>`;

  const landlordEmail = asString(landlordTenant?.email);
  if (landlordEmail) {
    const emailResult = await sendResendEmail({
      to: landlordEmail,
      subject: landlordSubject,
      html: landlordHtml,
      text: landlordText,
    });
    if (!emailResult.ok) {
      console.error(
        "[rent-ledger-paystack] landlord notice email failed:",
        emailResult.error,
      );
    }
  }

  const landlordPhone = normalizeGhanaPhone(landlordTenant?.phone);
  if (landlordPhone) {
    const smsParts = [
      `Davors: Rent ${amountLabel} received from ${lesseeName} (${periodLabel}) via ${options.paymentMethod}.`,
    ];
    if (escrowLine) {
      smsParts.push(escrowLine);
    }
    const smsResult = await sendHubtelSms({
      to: landlordPhone,
      content: smsParts.join(" "),
    });
    if (!smsResult.ok) {
      console.error(
        "[rent-ledger-paystack] landlord notice SMS failed:",
        smsResult.error,
      );
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Apply a verified Paystack charge to a rent_ledger row.
 * Idempotent via notes marker `[paystack:reference]`.
 */
export async function fulfillRentLedgerPaystackPayment(
  admin: SupabaseClient,
  options: {
    entryId?: string | null;
    reference: string;
    paidAmountGhs: number | null;
    paidAt: string | null;
    channel: string | null;
    metadataTenantId?: string | null;
    metadataLesseeId?: string | null;
    landlordTypeHint?: LandlordType | null;
    skipNotify?: boolean;
  },
): Promise<FulfillRentPaystackResult> {
  const reference = options.reference.trim();
  if (!reference) {
    throw new Error("Missing Paystack reference.");
  }

  const entry = await loadRentEntry(admin, {
    entryId: options.entryId,
    reference: options.entryId ? null : reference,
    tenantId: options.metadataTenantId,
  });

  if (!entry) {
    throw new Error("Rent ledger entry not found for this payment.");
  }

  if (
    options.metadataTenantId &&
    entry.tenant_id !== options.metadataTenantId
  ) {
    throw new Error("Rent ledger tenant_id metadata mismatch.");
  }

  const marker = paystackAppliedMarker(reference);
  const existingNotes = (entry.notes ?? "").trim();
  if (existingNotes.includes(marker)) {
    const amountDue = roundGhs(Number(entry.amount_due_ghs) || 0);
    const amountPaid = roundGhs(Number(entry.amount_paid_ghs) || 0);
    const status = resolveRentStatusAfterPayment(
      amountDue,
      amountPaid,
      (entry.status as RentLedgerStatus) || "pending",
    );
    const { balanceGhs } = await fetchEscrowBalanceForLandlord(
      admin,
      entry.tenant_id,
    );
    return {
      alreadyFulfilled: true,
      entryId: entry.entry_id,
      amountPaidGhs: amountPaid,
      status,
      verificationStatus: resolvePaystackRentVerificationStatus(),
      escrowBalanceAfterGhs: balanceGhs,
    };
  }

  const { data: landlordRow, error: landlordError } = await admin
    .from("landlords")
    .select("landlord_type")
    .eq("tenant_id", entry.tenant_id)
    .maybeSingle();

  if (landlordError) {
    throw new Error(landlordError.message);
  }

  const landlordType = (landlordRow?.landlord_type ??
    options.landlordTypeHint) as LandlordType | null;
  if (
    landlordType !== "platform_only" &&
    landlordType !== "davors_managed"
  ) {
    throw new Error("Landlord type must be set before accepting rent payments.");
  }

  const amountDue = roundGhs(Number(entry.amount_due_ghs) || 0);
  const existingPaid = roundGhs(Number(entry.amount_paid_ghs) || 0);
  const outstanding = roundGhs(Math.max(0, amountDue - existingPaid));
  const paidAmount =
    options.paidAmountGhs != null && Number.isFinite(options.paidAmountGhs)
      ? roundGhs(options.paidAmountGhs)
      : outstanding;

  if (paidAmount <= 0) {
    throw new Error("Paid amount must be greater than zero.");
  }

  // Allow tiny gateway rounding; reject clear underpayment.
  if (outstanding > 0 && paidAmount + 0.05 < outstanding) {
    throw new Error(
      `Paid amount ${paidAmount.toFixed(2)} is less than outstanding ${outstanding.toFixed(2)}.`,
    );
  }

  const applied = outstanding > 0 ? Math.min(paidAmount, outstanding) : paidAmount;
  const nextPaid = roundGhs(existingPaid + applied);
  const nextStatus = resolveRentStatusAfterPayment(
    amountDue,
    nextPaid,
    (entry.status as RentLedgerStatus) || "pending",
  );
  const verificationStatus = resolvePaystackRentVerificationStatus();
  const paymentMethod = paymentMethodLabelFromPaystackChannel(options.channel);
  const paidAtIso =
    options.paidAt?.trim() || new Date().toISOString();
  const nowIso = new Date().toISOString();
  const paymentNote = `Payment ${applied.toFixed(2)} via ${paymentMethod} (Paystack ${reference}).`;
  const nextNotes = [existingNotes, paymentNote, marker]
    .filter(Boolean)
    .join("\n");

  let escrowBalanceAfterGhs: number | null = null;

  // Escrow before rent update so a failed insert can retry without a paid-but-unescrowed row.
  if (landlordType === "davors_managed") {
    escrowBalanceAfterGhs = await insertEscrowCollection({
      admin,
      tenantId: entry.tenant_id,
      rentEntryId: entry.entry_id,
      amountGhs: applied,
      entryDate: paidAtIso,
    });
  }

  const { error: updateError } = await admin
    .from("rent_ledger")
    .update({
      amount_paid_ghs: nextPaid,
      payment_method: paymentMethod,
      payment_date: paidAtIso,
      status: nextStatus,
      verification_status: verificationStatus,
      paystack_reference: reference,
      notes: nextNotes || null,
      updated_at: nowIso,
    })
    .eq("tenant_id", entry.tenant_id)
    .eq("entry_id", entry.entry_id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  let lesseeId = options.metadataLesseeId?.trim() || null;
  if (!lesseeId) {
    const { data: lease } = await admin
      .from("leases")
      .select("lessee_id")
      .eq("tenant_id", entry.tenant_id)
      .eq("lease_id", entry.lease_id)
      .maybeSingle();
    lesseeId = lease?.lessee_id ?? null;
  }

  if (!options.skipNotify && lesseeId) {
    try {
      await notifyRentPaystackSuccess({
        tenantId: entry.tenant_id,
        landlordType,
        amountGhs: applied,
        periodStart: entry.period_start,
        periodEnd: entry.period_end,
        paymentMethod,
        escrowBalanceAfterGhs,
        lesseeId,
      });
    } catch (error) {
      console.error(
        "[rent-ledger-paystack] notification failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return {
    alreadyFulfilled: false,
    entryId: entry.entry_id,
    amountPaidGhs: nextPaid,
    status: nextStatus,
    verificationStatus,
    escrowBalanceAfterGhs,
  };
}

/**
 * Webhook path for charge.success with metadata.context === rent_ledger.
 */
export async function processRentLedgerPaystackEvent(
  data: JsonRecord,
): Promise<{ detail: string; ignored?: boolean }> {
  const meta = metadataObject(data);
  const reference = asString(data.reference);
  const entryId = asString(meta.entry_id) ?? asString(meta.rent_ledger_entry_id);
  const metadataTenantId = asString(meta.tenant_id);
  const metadataLesseeId = asString(meta.lessee_id);
  const landlordTypeHint = asString(meta.landlord_type) as LandlordType | null;
  const amountPesewas = asNumber(data.amount);
  const paidAmountGhs =
    amountPesewas != null ? roundGhs(amountPesewas / 100) : null;
  const paidAt =
    asString(data.paid_at) ?? asString(data.paidAt) ?? new Date().toISOString();
  const channel =
    asString(data.channel) ??
    asString(asRecord(data.authorization)?.channel);

  if (!reference) {
    return {
      ignored: true,
      detail: "rent_ledger charge.success missing reference — ignored.",
    };
  }

  if (!entryId && !reference) {
    return {
      ignored: true,
      detail: "rent_ledger charge.success missing entry_id — ignored.",
    };
  }

  const admin = createAdminClient();

  try {
    const result = await fulfillRentLedgerPaystackPayment(admin, {
      entryId,
      reference,
      paidAmountGhs,
      paidAt,
      channel,
      metadataTenantId,
      metadataLesseeId,
      landlordTypeHint:
        landlordTypeHint === "platform_only" ||
        landlordTypeHint === "davors_managed"
          ? landlordTypeHint
          : null,
    });

    return {
      detail: `rent_ledger charge.success ${result.alreadyFulfilled ? "idempotent" : "applied"} entry ${result.entryId} (ref=${reference}, status=${result.status}).`,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown rent fulfillment error";
    // Not found / mismatch → ignore so subscription handler isn't wrongly hit
    // (caller already branched on context). Surface as error via throw for webhook.
    throw new Error(`rent_ledger fulfillment failed: ${message}`);
  }
}
