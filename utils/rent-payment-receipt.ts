import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatRentLedgerStatus,
  formatRentPaymentMethod,
  rentOutstandingGhs,
  type RentLedgerStatus,
} from "@/app/dashboard/real-estate/rent-ledger-utils";
import { resolveChargeDisplayLabel } from "@/utils/lease-charge-categories";

export type RentPaymentReceiptData = {
  entryId: string;
  receiptReference: string;
  chargeType: "rent" | "one_time";
  chargeTypeLabel: string;
  description: string | null;
  lesseeName: string;
  landlordName: string;
  propertyName: string;
  unitNumber: string;
  unitLabel: string;
  periodStart: string;
  periodEnd: string;
  amountDueGhs: number;
  amountPaidGhs: number;
  creditGhs: number;
  outstandingGhs: number;
  status: string;
  statusLabel: string;
  paymentDate: string | null;
  paymentMethod: string | null;
  paymentMethodLabel: string;
  notes: string | null;
  documentTitle: string;
};

export type PortalPaymentHistoryRow = {
  entryId: string;
  chargeType: "rent" | "one_time";
  chargeTypeLabel: string;
  description: string | null;
  periodStart: string;
  periodEnd: string;
  amountPaidGhs: number;
  paymentDate: string | null;
  paymentMethodLabel: string;
  receiptReference: string;
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildReceiptReference(
  entryId: string,
  paystackReference: string | null | undefined,
): string {
  const ref = paystackReference?.trim();
  return ref || entryId;
}

function chargeTypeLabel(
  chargeType: "rent" | "one_time",
  description: string | null,
  chargeCategory: string | null | undefined,
) {
  if (chargeType === "one_time") {
    const label = resolveChargeDisplayLabel({
      chargeCategory,
      description,
    });
    return chargeCategory ? label : description ? `One-time — ${description}` : "One-time charge";
  }
  return "Rent";
}

function documentTitleForCharge(chargeType: "rent" | "one_time") {
  return chargeType === "one_time"
    ? "One-time charge receipt"
    : "Rent payment receipt";
}

export function isConfirmedRentLedgerPayment(row: {
  status: string;
  amount_paid_ghs: unknown;
  payment_date: string | null;
}): boolean {
  const amountPaid = toNumber(row.amount_paid_ghs);
  if (amountPaid <= 0 || !row.payment_date) {
    return false;
  }
  return row.status === "paid" || row.status === "partial";
}

export async function fetchRentPaymentReceipt(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    entryId: string;
    lesseeId?: string | null;
  },
): Promise<{ receipt: RentPaymentReceiptData | null; error: string | null }> {
  const entryId = options.entryId.trim();
  if (!entryId) {
    return { receipt: null, error: "entry_id is required" };
  }

  const { data: rentRow, error: rentError } = await admin
    .from("rent_ledger")
    .select(
      "entry_id, lease_id, charge_type, charge_category, description, period_start, period_end, status, amount_due_ghs, amount_paid_ghs, credit_ghs, payment_date, payment_method, notes, paystack_reference",
    )
    .eq("tenant_id", options.tenantId)
    .eq("entry_id", entryId)
    .maybeSingle();

  if (rentError) {
    return { receipt: null, error: rentError.message };
  }
  if (!rentRow) {
    return { receipt: null, error: null };
  }

  if (!isConfirmedRentLedgerPayment(rentRow)) {
    return {
      receipt: null,
      error: "Receipt is available only for confirmed payments.",
    };
  }

  const [{ data: lease }, { data: tenantRow }] = await Promise.all([
    admin
      .from("leases")
      .select("lease_id, unit_id, lessee_id")
      .eq("tenant_id", options.tenantId)
      .eq("lease_id", rentRow.lease_id)
      .maybeSingle(),
    admin
      .from("tenants")
      .select("name")
      .eq("id", options.tenantId)
      .maybeSingle(),
  ]);

  if (!lease) {
    return { receipt: null, error: "Lease not found for this payment." };
  }

  if (options.lesseeId && lease.lessee_id !== options.lesseeId) {
    return { receipt: null, error: "Access denied." };
  }

  const { data: unit } = await admin
    .from("property_units")
    .select("unit_id, unit_number, property_id")
    .eq("tenant_id", options.tenantId)
    .eq("unit_id", lease.unit_id)
    .maybeSingle();

  const [{ data: property }, { data: lessee }] = await Promise.all([
    unit
      ? admin
          .from("properties")
          .select("property_id, name")
          .eq("tenant_id", options.tenantId)
          .eq("property_id", unit.property_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from("lessees")
      .select("lessee_id, full_name")
      .eq("tenant_id", options.tenantId)
      .eq("lessee_id", lease.lessee_id)
      .maybeSingle(),
  ]);

  const propertyName = property?.name?.trim() || "—";
  const unitNumber = unit?.unit_number?.trim() || "—";
  const chargeType = rentRow.charge_type === "one_time" ? "one_time" : "rent";
  const chargeCategory =
    typeof rentRow.charge_category === "string"
      ? rentRow.charge_category.trim() || null
      : null;
  const description =
    typeof rentRow.description === "string"
      ? rentRow.description.trim() || null
      : null;
  const amountDue = toNumber(rentRow.amount_due_ghs);
  const amountPaid = toNumber(rentRow.amount_paid_ghs);
  const creditGhs = toNumber(rentRow.credit_ghs);

  return {
    receipt: {
      entryId: rentRow.entry_id,
      receiptReference: buildReceiptReference(
        rentRow.entry_id,
        rentRow.paystack_reference,
      ),
      chargeType,
      chargeTypeLabel: chargeTypeLabel(chargeType, description, chargeCategory),
      description,
      lesseeName: lessee?.full_name?.trim() || "—",
      landlordName: tenantRow?.name?.trim() || "—",
      propertyName,
      unitNumber,
      unitLabel: `${propertyName} · ${unitNumber}`,
      periodStart: rentRow.period_start,
      periodEnd: rentRow.period_end,
      amountDueGhs: amountDue,
      amountPaidGhs: amountPaid,
      creditGhs,
      outstandingGhs: rentOutstandingGhs(amountDue, amountPaid, creditGhs),
      status: rentRow.status,
      statusLabel: formatRentLedgerStatus(rentRow.status as RentLedgerStatus),
      paymentDate: rentRow.payment_date,
      paymentMethod: rentRow.payment_method,
      paymentMethodLabel: formatRentPaymentMethod(rentRow.payment_method),
      notes: rentRow.notes?.trim() || null,
      documentTitle: documentTitleForCharge(chargeType),
    },
    error: null,
  };
}

export async function fetchPortalPaymentHistory(
  admin: SupabaseClient,
  options: { tenantId: string; lesseeId: string; leaseId: string },
): Promise<{ rows: PortalPaymentHistoryRow[]; error: string | null }> {
  const { data: rentRows, error } = await admin
    .from("rent_ledger")
    .select(
      "entry_id, charge_type, charge_category, description, period_start, period_end, status, amount_paid_ghs, payment_date, payment_method, paystack_reference",
    )
    .eq("tenant_id", options.tenantId)
    .eq("lease_id", options.leaseId)
    .order("payment_date", { ascending: false })
    .order("period_start", { ascending: false })
    .limit(100);

  if (error) {
    return { rows: [], error: error.message };
  }

  const rows: PortalPaymentHistoryRow[] = [];
  for (const row of rentRows ?? []) {
    if (!isConfirmedRentLedgerPayment(row)) {
      continue;
    }
    const chargeType = row.charge_type === "one_time" ? "one_time" : "rent";
    const chargeCategory =
      typeof row.charge_category === "string"
        ? row.charge_category.trim() || null
        : null;
    const description =
      typeof row.description === "string" ? row.description.trim() || null : null;
    rows.push({
      entryId: row.entry_id,
      chargeType,
      chargeTypeLabel: chargeTypeLabel(chargeType, description, chargeCategory),
      description,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      amountPaidGhs: toNumber(row.amount_paid_ghs),
      paymentDate: row.payment_date,
      paymentMethodLabel: formatRentPaymentMethod(row.payment_method),
      receiptReference: buildReceiptReference(row.entry_id, row.paystack_reference),
    });
  }

  return { rows, error: null };
}
