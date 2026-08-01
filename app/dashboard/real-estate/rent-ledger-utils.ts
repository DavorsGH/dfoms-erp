import type { LandlordType } from "./landlords-utils";

export type RentLedgerStatus = "pending" | "partial" | "paid" | "overdue";

export type RentPaymentMethod = "cash" | "bank_transfer";

export type RentVerificationStatus =
  | "not_required"
  | "pending_verification"
  | "verified";

export type RentLedgerListRow = {
  entryId: string;
  tenantId: string;
  leaseId: string;
  tenantName: string;
  unitLabel: string;
  periodStart: string;
  periodEnd: string;
  amountDueGhs: number;
  amountPaidGhs: number;
  status: RentLedgerStatus;
  paymentMethod: string | null;
  paymentDate: string | null;
  verificationStatus: RentVerificationStatus;
  notes: string | null;
};

export const RENT_LEDGER_STATUS_OPTIONS: Array<{
  value: RentLedgerStatus;
  label: string;
}> = [
  { value: "pending", label: "Pending" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

export const MANUAL_PAYMENT_METHOD_OPTIONS: Array<{
  value: RentPaymentMethod;
  label: string;
}> = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
];

export function formatRentLedgerStatus(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }
  const match = RENT_LEDGER_STATUS_OPTIONS.find(
    (option) => option.value === value,
  );
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatRentPaymentMethod(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }
  const match = MANUAL_PAYMENT_METHOD_OPTIONS.find(
    (option) => option.value === value,
  );
  if (match) {
    return match.label;
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatRentMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) {
    return "—";
  }
  return `GHS ${Number(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatRentPeriod(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start || !end) {
    return "—";
  }
  const startLabel = new Date(start).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const endLabel = new Date(end).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${startLabel} – ${endLabel}`;
}

export function formatRentDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function isRentLedgerStatus(value: string): value is RentLedgerStatus {
  return RENT_LEDGER_STATUS_OPTIONS.some((option) => option.value === value);
}

export function isManualPaymentMethod(
  value: string,
): value is RentPaymentMethod {
  return value === "cash" || value === "bank_transfer";
}

export function isRentVerificationStatus(
  value: string,
): value is RentVerificationStatus {
  return (
    value === "not_required" ||
    value === "pending_verification" ||
    value === "verified"
  );
}

export function resolveManualPaymentVerificationStatus(
  landlordType: LandlordType | null | undefined,
): RentVerificationStatus {
  return landlordType === "davors_managed"
    ? "pending_verification"
    : "not_required";
}

/**
 * Paystack Inline (verify/webhook confirmed) is trusted immediately for both
 * landlord types. Manual davors_managed cash/transfer still uses
 * pending_verification via resolveManualPaymentVerificationStatus.
 */
export function resolvePaystackPaymentVerificationStatus(): RentVerificationStatus {
  return "not_required";
}

export function resolveRentStatusAfterPayment(
  amountDueGhs: number,
  amountPaidGhs: number,
  currentStatus: RentLedgerStatus,
): RentLedgerStatus {
  if (amountPaidGhs >= amountDueGhs) {
    return "paid";
  }
  if (amountPaidGhs > 0) {
    return "partial";
  }
  return currentStatus === "overdue" ? "overdue" : "pending";
}
