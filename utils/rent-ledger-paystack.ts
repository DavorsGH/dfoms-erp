import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchEscrowBalanceForLandlord } from "@/utils/payout-management";
import { voidNotifyRentPaymentSuccess } from "@/utils/real-estate-document-notifications";
import { roundPayoutMoney } from "@/app/dashboard/real-estate/payouts-utils";
import {
  formatRentMoney,
  formatRentPaymentMethod,
  formatRentPeriod,
  resolvePaystackPaymentVerificationStatus,
  resolveRentStatusAfterPayment,
  rentOutstandingGhs,
  type RentLedgerPaymentMethod,
  type RentLedgerStatus,
  type RentVerificationStatus,
} from "@/app/dashboard/real-estate/rent-ledger-utils";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
import { postRentPaystackFee } from "@/utils/paystack-finance-posting";

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

/**
 * Map Paystack verify/webhook channel to rent_ledger.payment_method values
 * allowed by rent_ledger_payment_method_check (paystack_momo | paystack_card |
 * cash | bank_transfer).
 */
export function paymentMethodFromPaystackChannel(
  channel: string | null | undefined,
): RentLedgerPaymentMethod {
  const normalized = (channel ?? "").trim().toLowerCase();
  if (normalized === "mobile_money" || normalized === "mobile money") {
    return "paystack_momo";
  }
  if (normalized === "card") {
    return "paystack_card";
  }
  // Portal initialize restricts channels to mobile_money + card; MoMo is the
  // common Ghana default when verify omits channel.
  return "paystack_momo";
}

/** @deprecated Use paymentMethodFromPaystackChannel + formatRentPaymentMethod */
export function paymentMethodLabelFromPaystackChannel(
  channel: string | null | undefined,
): string {
  return formatRentPaymentMethod(paymentMethodFromPaystackChannel(channel));
}

export function isRentLedgerPaystackContext(data: JsonRecord): boolean {
  const meta = metadataObject(data);
  return asString(meta.context) === RENT_LEDGER_PAYSTACK_CONTEXT;
}

export type FulfillRentPaystackResult = {
  alreadyFulfilled: boolean;
  entryId: string;
  entryIds: string[];
  amountPaidGhs: number;
  totalAppliedGhs: number;
  status: RentLedgerStatus;
  verificationStatus: RentVerificationStatus;
  escrowBalanceAfterGhs: number | null;
};

type RentEntryRow = {
  entry_id: string;
  tenant_id: string;
  lease_id: string;
  charge_type: string | null;
  description: string | null;
  period_start: string;
  period_end: string;
  amount_due_ghs: number | string;
  amount_paid_ghs: number | string;
  credit_ghs?: number | string | null;
  status: string;
  payment_method: string | null;
  payment_date: string | null;
  verification_status: string | null;
  paystack_reference: string | null;
  notes: string | null;
};

const RENT_ENTRY_SELECT =
  "entry_id, tenant_id, lease_id, charge_type, description, period_start, period_end, amount_due_ghs, amount_paid_ghs, credit_ghs, status, payment_method, payment_date, verification_status, paystack_reference, notes";

function parseEntryIdsFromMetadata(meta: JsonRecord): string[] {
  const ids: string[] = [];
  const raw = meta.entry_ids;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const id = asString(item);
      if (id) ids.push(id);
    }
  } else if (typeof raw === "string") {
    for (const part of raw.split(",")) {
      const id = part.trim();
      if (id) ids.push(id);
    }
  }
  const single =
    asString(meta.entry_id) ?? asString(meta.rent_ledger_entry_id);
  if (single && !ids.includes(single)) {
    ids.unshift(single);
  }
  return [...new Set(ids)];
}

export function parseRentPaystackMetadataEntryIds(
  meta: Record<string, unknown>,
): string[] {
  return parseEntryIdsFromMetadata(meta);
}

function sortEntriesForAllocation(entries: RentEntryRow[]): RentEntryRow[] {
  return [...entries].sort((a, b) => {
    const aRent = (a.charge_type ?? "rent") === "rent" ? 0 : 1;
    const bRent = (b.charge_type ?? "rent") === "rent" ? 0 : 1;
    if (aRent !== bRent) return aRent - bRent;
    const byPeriod = a.period_start.localeCompare(b.period_start);
    if (byPeriod !== 0) return byPeriod;
    return a.entry_id.localeCompare(b.entry_id);
  });
}

async function loadRentEntries(
  admin: SupabaseClient,
  options: {
    entryIds?: string[] | null;
    entryId?: string | null;
    reference?: string | null;
    tenantId?: string | null;
  },
): Promise<RentEntryRow[]> {
  const explicitIds = [
    ...new Set(
      [
        ...(options.entryIds ?? []),
        options.entryId?.trim() || null,
      ].filter((id): id is string => Boolean(id)),
    ),
  ];

  if (explicitIds.length > 0) {
    let query = admin
      .from("rent_ledger")
      .select(RENT_ENTRY_SELECT)
      .in("entry_id", explicitIds);
    if (options.tenantId) {
      query = query.eq("tenant_id", options.tenantId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }
    const rows = (data as RentEntryRow[] | null) ?? [];
    const byId = new Map(rows.map((row) => [row.entry_id, row]));
    return explicitIds
      .map((id) => byId.get(id))
      .filter((row): row is RentEntryRow => Boolean(row));
  }

  if (options.reference) {
    let query = admin
      .from("rent_ledger")
      .select(RENT_ENTRY_SELECT)
      .eq("paystack_reference", options.reference)
      .order("period_start", { ascending: true });
    if (options.tenantId) {
      query = query.eq("tenant_id", options.tenantId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }
    return (data as RentEntryRow[] | null) ?? [];
  }

  return [];
}

function sortedUniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort();
}

async function assertReferenceNotFulfilledForOtherEntries(
  admin: SupabaseClient,
  reference: string,
  targetEntryIds: string[],
): Promise<void> {
  const marker = paystackAppliedMarker(reference);
  const targetSet = new Set(targetEntryIds);
  const { data, error } = await admin
    .from("rent_ledger")
    .select("entry_id, notes")
    .eq("paystack_reference", reference);

  if (error) {
    throw new Error(error.message);
  }

  const fulfilledElsewhere = (
    (data as Array<{ entry_id: string; notes: string | null }> | null) ?? []
  ).filter(
    (row) =>
      (row.notes ?? "").includes(marker) && !targetSet.has(row.entry_id),
  );

  if (fulfilledElsewhere.length > 0) {
    throw new Error(
      "This Paystack reference was already applied to other rent ledger entries.",
    );
  }
}

async function validateRentPaystackMetadataAgainstEntries(
  admin: SupabaseClient,
  options: {
    reference: string;
    entries: RentEntryRow[];
    metadataTenantId?: string | null;
    metadataLesseeId?: string | null;
    metadataLeaseId?: string | null;
    metadataEntryIds?: string[] | null;
  },
): Promise<void> {
  const { entries, reference } = options;
  if (entries.length === 0) {
    return;
  }

  const tenantId = entries[0].tenant_id;
  const leaseId = entries[0].lease_id;
  const marker = paystackAppliedMarker(reference);
  const targetEntryIds = entries.map((entry) => entry.entry_id);

  for (const entry of entries) {
    if ((entry.notes ?? "").includes(marker)) {
      continue;
    }
    const storedRef = asString(entry.paystack_reference);
    if (!storedRef || storedRef !== reference) {
      throw new Error(
        "Rent ledger paystack_reference does not match this payment reference.",
      );
    }
  }

  const metaTenantId = asString(options.metadataTenantId);
  const metaLesseeId = asString(options.metadataLesseeId);
  const metaLeaseId = asString(options.metadataLeaseId);

  if (!metaTenantId || !metaLesseeId || !metaLeaseId) {
    throw new Error(
      "Paystack payment metadata is missing required rent ledger identifiers.",
    );
  }

  if (metaTenantId !== tenantId) {
    throw new Error(
      "Paystack payment tenant_id does not match rent ledger entries.",
    );
  }
  if (metaLeaseId !== leaseId) {
    throw new Error(
      "Paystack payment lease_id does not match rent ledger entries.",
    );
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lessee_id")
    .eq("tenant_id", tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (leaseError) {
    throw new Error(leaseError.message);
  }
  if (!lease?.lessee_id) {
    throw new Error("Lease not found for rent ledger entries.");
  }
  if (lease.lessee_id !== metaLesseeId) {
    throw new Error(
      "Paystack payment lessee_id does not match rent ledger lease.",
    );
  }

  const metadataEntryIds = sortedUniqueIds(options.metadataEntryIds ?? []);
  if (metadataEntryIds.length > 0) {
    const targetIds = sortedUniqueIds(targetEntryIds);
    if (
      targetIds.length !== metadataEntryIds.length ||
      !targetIds.every((id, index) => id === metadataEntryIds[index])
    ) {
      throw new Error(
        "Paystack payment entry_ids do not match rent ledger entries being fulfilled.",
      );
    }
  }

  await assertReferenceNotFulfilledForOtherEntries(
    admin,
    reference,
    targetEntryIds,
  );
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

/**
 * Apply a verified Paystack charge to one or more rent_ledger rows.
 * Idempotent via notes marker `[paystack:reference]` on each applied row.
 * Allocation order: rent rows first, then one_time (by period_start).
 */
export async function fulfillRentLedgerPaystackPayment(
  admin: SupabaseClient,
  options: {
    entryId?: string | null;
    entryIds?: string[] | null;
    reference: string;
    paidAmountGhs: number | null;
    paidAt: string | null;
    channel: string | null;
    metadataTenantId?: string | null;
    metadataLesseeId?: string | null;
    metadataLeaseId?: string | null;
    metadataEntryIds?: string[] | null;
    landlordTypeHint?: LandlordType | null;
    skipNotify?: boolean;
  },
): Promise<FulfillRentPaystackResult> {
  const reference = options.reference.trim();
  if (!reference) {
    throw new Error("Missing Paystack reference.");
  }

  const entries = await loadRentEntries(admin, {
    entryIds: options.entryIds,
    entryId: options.entryId,
    reference:
      options.entryId || (options.entryIds && options.entryIds.length > 0)
        ? null
        : reference,
    tenantId: options.metadataTenantId,
  });

  if (entries.length === 0) {
    throw new Error("Rent ledger entry not found for this payment.");
  }

  const tenantId = entries[0].tenant_id;
  const leaseId = entries[0].lease_id;
  for (const entry of entries) {
    if (entry.tenant_id !== tenantId || entry.lease_id !== leaseId) {
      throw new Error("Bundled rent payment entries must share the same lease.");
    }
  }

  await validateRentPaystackMetadataAgainstEntries(admin, {
    reference,
    entries,
    metadataTenantId: options.metadataTenantId,
    metadataLesseeId: options.metadataLesseeId,
    metadataLeaseId: options.metadataLeaseId,
    metadataEntryIds: options.metadataEntryIds,
  });

  const marker = paystackAppliedMarker(reference);
  const alreadyApplied = entries.filter((entry) =>
    (entry.notes ?? "").includes(marker),
  );
  if (alreadyApplied.length === entries.length) {
    const { data: landlordRowEarly, error: landlordErrorEarly } = await admin
      .from("landlords")
      .select("landlord_type")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (landlordErrorEarly) {
      throw new Error(landlordErrorEarly.message);
    }

    const landlordTypeEarly = (landlordRowEarly?.landlord_type ??
      options.landlordTypeHint) as LandlordType | null;
    if (
      landlordTypeEarly !== "platform_only" &&
      landlordTypeEarly !== "davors_managed"
    ) {
      throw new Error("Landlord type must be set before accepting rent payments.");
    }

    const idempotentPaidAmount =
      options.paidAmountGhs != null && Number.isFinite(options.paidAmountGhs)
        ? roundGhs(options.paidAmountGhs)
        : roundGhs(
            alreadyApplied.reduce(
              (sum, entry) => sum + roundGhs(Number(entry.amount_paid_ghs) || 0),
              0,
            ),
          );

    await postRentPaystackFee(admin, {
      landlordTenantId: tenantId,
      landlordType: landlordTypeEarly,
      leaseId,
      reference,
      transactionAmountGhs: idempotentPaidAmount,
      paidAt: options.paidAt,
    });

    const primary = entries[0];
    const amountDue = roundGhs(Number(primary.amount_due_ghs) || 0);
    const amountPaid = roundGhs(Number(primary.amount_paid_ghs) || 0);
    const creditGhs = roundGhs(Number(primary.credit_ghs) || 0);
    const status = resolveRentStatusAfterPayment(
      amountDue,
      amountPaid,
      (primary.status as RentLedgerStatus) || "pending",
      creditGhs,
    );
    const { balanceGhs } = await fetchEscrowBalanceForLandlord(admin, tenantId);
    return {
      alreadyFulfilled: true,
      entryId: primary.entry_id,
      entryIds: entries.map((e) => e.entry_id),
      amountPaidGhs: amountPaid,
      totalAppliedGhs: entries.reduce(
        (sum, e) => sum + roundGhs(Number(e.amount_paid_ghs) || 0),
        0,
      ),
      status,
      verificationStatus: resolvePaystackRentVerificationStatus(),
      escrowBalanceAfterGhs: balanceGhs,
    };
  }
  if (alreadyApplied.length > 0) {
    throw new Error(
      "Partial Paystack fulfillment detected for this reference. Resolve manually before retrying.",
    );
  }

  const { data: landlordRow, error: landlordError } = await admin
    .from("landlords")
    .select("landlord_type")
    .eq("tenant_id", tenantId)
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

  const ordered = sortEntriesForAllocation(entries);
  const outstandingByEntry = ordered.map((entry) => {
    const amountDue = roundGhs(Number(entry.amount_due_ghs) || 0);
    const existingPaid = roundGhs(Number(entry.amount_paid_ghs) || 0);
    const creditGhs = roundGhs(Number(entry.credit_ghs) || 0);
    return {
      entry,
      amountDue,
      existingPaid,
      creditGhs,
      outstanding: rentOutstandingGhs(amountDue, existingPaid, creditGhs),
    };
  });

  const totalOutstanding = roundGhs(
    outstandingByEntry.reduce((sum, row) => sum + row.outstanding, 0),
  );
  const paidAmount =
    options.paidAmountGhs != null && Number.isFinite(options.paidAmountGhs)
      ? roundGhs(options.paidAmountGhs)
      : totalOutstanding;

  if (paidAmount <= 0) {
    throw new Error("Paid amount must be greater than zero.");
  }

  if (totalOutstanding > 0 && paidAmount + 0.05 < totalOutstanding) {
    throw new Error(
      `Paid amount ${paidAmount.toFixed(2)} is less than outstanding ${totalOutstanding.toFixed(2)}.`,
    );
  }

  const paymentMethod = paymentMethodFromPaystackChannel(options.channel);
  const paymentMethodLabel = formatRentPaymentMethod(paymentMethod);
  const paidAtIso = options.paidAt?.trim() || new Date().toISOString();
  const nowIso = new Date().toISOString();
  const verificationStatus = resolvePaystackRentVerificationStatus();

  let remaining = paidAmount;
  let totalApplied = 0;
  let escrowBalanceAfterGhs: number | null = null;
  let primaryStatus: RentLedgerStatus = "paid";
  let primaryPaid = 0;
  let primarySet = false;

  for (const row of outstandingByEntry) {
    const apply =
      row.outstanding > 0
        ? roundGhs(Math.min(remaining, row.outstanding))
        : 0;
    if (apply <= 0) {
      continue;
    }

    const nextPaid = roundGhs(row.existingPaid + apply);
    const nextStatus = resolveRentStatusAfterPayment(
      row.amountDue,
      nextPaid,
      (row.entry.status as RentLedgerStatus) || "pending",
      row.creditGhs,
    );
    const existingNotes = (row.entry.notes ?? "").trim();
    const paymentNote = `Payment ${apply.toFixed(2)} via ${paymentMethodLabel} (Paystack ${reference}).`;
    const nextNotes = [existingNotes, paymentNote, marker]
      .filter(Boolean)
      .join("\n");

    if (landlordType === "davors_managed") {
      escrowBalanceAfterGhs = await insertEscrowCollection({
        admin,
        tenantId,
        rentEntryId: row.entry.entry_id,
        amountGhs: apply,
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
      .eq("tenant_id", tenantId)
      .eq("entry_id", row.entry.entry_id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    remaining = roundGhs(remaining - apply);
    totalApplied = roundGhs(totalApplied + apply);
    if (!primarySet) {
      primaryStatus = nextStatus;
      primaryPaid = nextPaid;
      primarySet = true;
    }
  }

  if (totalApplied <= 0) {
    throw new Error("Nothing outstanding to apply this payment to.");
  }

  await postRentPaystackFee(admin, {
    landlordTenantId: tenantId,
    landlordType,
    leaseId,
    reference,
    transactionAmountGhs: paidAmount,
    paidAt: paidAtIso,
  });

  let lesseeId = options.metadataLesseeId?.trim() || null;
  if (!lesseeId) {
    const { data: lease } = await admin
      .from("leases")
      .select("lessee_id")
      .eq("tenant_id", tenantId)
      .eq("lease_id", leaseId)
      .maybeSingle();
    lesseeId = lease?.lessee_id ?? null;
  }

  const primaryEntry = ordered[0];
  const periodLabelEntries = ordered.filter((e) =>
    outstandingByEntry.some(
      (row) => row.entry.entry_id === e.entry_id && row.outstanding > 0,
    ),
  );
  const notifyPeriodStart = periodLabelEntries[0]?.period_start ?? primaryEntry.period_start;
  const notifyPeriodEnd =
    periodLabelEntries[periodLabelEntries.length - 1]?.period_end ??
    primaryEntry.period_end;

  if (!options.skipNotify && lesseeId) {
    voidNotifyRentPaymentSuccess({
      tenantId,
      landlordType,
      amountGhs: totalApplied,
      periodStart: notifyPeriodStart,
      periodEnd: notifyPeriodEnd,
      paymentMethod: paymentMethodLabel,
      escrowBalanceAfterGhs,
      lesseeId,
      primaryEntryId: primaryEntry.entry_id,
      paymentReference: reference,
    });
  }

  return {
    alreadyFulfilled: false,
    entryId: primaryEntry.entry_id,
    entryIds: ordered.map((e) => e.entry_id),
    amountPaidGhs: primaryPaid || roundGhs(Number(primaryEntry.amount_paid_ghs) || 0),
    totalAppliedGhs: totalApplied,
    status: primaryStatus,
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
  const entryIds = parseEntryIdsFromMetadata(meta);
  const entryId = entryIds[0] ?? null;
  const metadataTenantId = asString(meta.tenant_id);
  const metadataLesseeId = asString(meta.lessee_id);
  const metadataLeaseId = asString(meta.lease_id);
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

  const admin = createAdminClient();

  try {
    const result = await fulfillRentLedgerPaystackPayment(admin, {
      entryId,
      entryIds: entryIds.length > 0 ? entryIds : null,
      reference,
      paidAmountGhs,
      paidAt,
      channel,
      metadataTenantId,
      metadataLesseeId,
      metadataLeaseId,
      metadataEntryIds: entryIds.length > 0 ? entryIds : null,
      landlordTypeHint:
        landlordTypeHint === "platform_only" ||
        landlordTypeHint === "davors_managed"
          ? landlordTypeHint
          : null,
    });

    return {
      detail: `rent_ledger charge.success ${result.alreadyFulfilled ? "idempotent" : "applied"} entries ${result.entryIds.join(",")} (ref=${reference}, applied=${result.totalAppliedGhs}, status=${result.status}).`,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown rent fulfillment error";
    throw new Error(`rent_ledger fulfillment failed: ${message}`);
  }
}
