export type LeaseStatus =
  | "active"
  | "terminated_early"
  | "expired"
  | "renewed";

export type RentChangeStatus =
  | "pending_staff_approval"
  | "approved"
  | "rejected";

/** Same value set as rent_change_status — tenant early-termination request. */
export type TerminationRequestStatus = RentChangeStatus;

export type LateFeeType = "fixed" | "percent";

export type DepositStatus =
  | "held"
  | "returned"
  | "forfeited"
  | "partially_forfeited";

export type SignatureStatus =
  | "unsigned"
  | "sent"
  | "partially_signed"
  | "signed";

export type VacantUnitOption = {
  unitId: string;
  unitNumber: string;
  propertyId: string;
  propertyName: string;
  baseRentGhs: number;
};

export type LesseeOption = {
  lesseeId: string;
  fullName: string;
  phone: string;
  email: string | null;
  status: string;
};

export type LeaseListRow = {
  leaseId: string;
  tenantId: string;
  unitId: string;
  unitNumber: string;
  propertyName: string;
  lesseeId: string;
  lesseeName: string;
  startDate: string;
  endDate: string;
  rentAmountGhs: number;
  status: LeaseStatus;
};

export type SecurityDepositRecord = {
  depositId: string;
  tenantId: string;
  leaseId: string;
  amountGhs: number;
  status: DepositStatus;
  amountReturnedGhs: number | null;
  dateCollected: string;
  dateResolved: string | null;
  resolutionNotes: string | null;
};

export type LeaseDetail = {
  leaseId: string;
  tenantId: string;
  landlordName: string;
  landlordAddress: string | null;
  landlordPhone: string | null;
  unitId: string;
  unitNumber: string;
  propertyName: string;
  /** Composed property street + unit for tenancy PDF. */
  propertyAddress: string;
  /** City / region used as witness LOCATION. */
  propertyLocation: string;
  lesseeId: string;
  lesseeName: string;
  lesseePhone: string;
  lesseeEmail: string | null;
  startDate: string;
  endDate: string;
  rentAmountGhs: number;
  /** Advance rent (GHS) for tenancy PDF — leases.advance_rent_amount_ghs */
  advanceRentAmountGhs: number;
  /** Prior notice months for PDF — leases.termination_notice_months */
  terminationNoticeMonths: number;
  pendingRentAmountGhs: number | null;
  rentChangeStatus: RentChangeStatus | null;
  pendingTerminationReason: string | null;
  terminationRequestStatus: TerminationRequestStatus | null;
  escalationPercent: number | null;
  escalationFrequencyMonths: number | null;
  lateFeeEnabled: boolean;
  lateFeeType: LateFeeType | null;
  lateFeeAmount: number | null;
  status: LeaseStatus;
  terminatedAt: string | null;
  terminationReason: string | null;
  signatureStatus: SignatureStatus;
  /** Custom uploaded lease PDF/Word URL; when set, preferred over generated default. */
  leaseDocumentUrl: string | null;
  /** Move-in condition photos (separate from listing/marketing photos). */
  moveInConditionPhotoUrls: string[];
  landlordAcknowledgedAt: string | null;
  tenantAcknowledgedAt: string | null;
  landlordAcknowledgedBy?: string | null;
  tenantAcknowledgedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  deposit: SecurityDepositRecord | null;
};

export const LEASE_STATUS_OPTIONS: Array<{
  value: LeaseStatus;
  label: string;
}> = [
  { value: "active", label: "Active" },
  { value: "terminated_early", label: "Terminated Early" },
  { value: "expired", label: "Expired" },
  { value: "renewed", label: "Renewed" },
];

export const LATE_FEE_TYPE_OPTIONS: Array<{
  value: LateFeeType;
  label: string;
}> = [
  { value: "fixed", label: "Fixed (GHS)" },
  { value: "percent", label: "Percent (%)" },
];

export const DEPOSIT_STATUS_OPTIONS: Array<{
  value: DepositStatus;
  label: string;
}> = [
  { value: "held", label: "Held" },
  { value: "returned", label: "Returned" },
  { value: "forfeited", label: "Forfeited" },
  { value: "partially_forfeited", label: "Partially Forfeited" },
];

export function formatLeaseStatus(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const match = LEASE_STATUS_OPTIONS.find((option) => option.value === value);
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatDepositStatus(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const match = DEPOSIT_STATUS_OPTIONS.find((option) => option.value === value);
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatLeaseDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatLeaseMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) {
    return "—";
  }
  return `GHS ${Number(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function isLeaseStatus(value: string): value is LeaseStatus {
  return LEASE_STATUS_OPTIONS.some((option) => option.value === value);
}

export function isRentChangeStatus(value: string): value is RentChangeStatus {
  return (
    value === "pending_staff_approval" ||
    value === "approved" ||
    value === "rejected"
  );
}

export function isTerminationRequestStatus(
  value: string,
): value is TerminationRequestStatus {
  return isRentChangeStatus(value);
}

export function isLateFeeType(value: string): value is LateFeeType {
  return value === "fixed" || value === "percent";
}

export function isDepositStatus(value: string): value is DepositStatus {
  return DEPOSIT_STATUS_OPTIONS.some((option) => option.value === value);
}

export function isSignatureStatus(value: string): value is SignatureStatus {
  return (
    value === "unsigned" ||
    value === "sent" ||
    value === "partially_signed" ||
    value === "signed"
  );
}

/** Default notice period when termination_notice_months is unset (new leases / fallback). */
export const DEFAULT_TERMINATION_NOTICE_MONTHS = 3;

export const DEFAULT_LEASE_NOTICE_PERIOD_LABEL = "3 months";

export function computeLeaseTermMonths(
  startDate: string,
  endDate: string,
): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth()) +
    (end.getDate() >= start.getDate() ? 0 : -1);
  return Math.max(1, months);
}

export function formatTerminationNoticeLabel(months: number): string {
  if (!Number.isFinite(months) || months < 1) {
    return DEFAULT_LEASE_NOTICE_PERIOD_LABEL;
  }
  const whole = Math.trunc(months);
  return whole === 1 ? "1 month" : `${whole} months`;
}

/** Suggested advance on create: rent × term months (independently overridable). */
export function suggestAdvanceRentAmountGhs(
  rentAmountGhs: number,
  startDate: string,
  endDate: string,
): number {
  if (!Number.isFinite(rentAmountGhs) || rentAmountGhs < 0) {
    return 0;
  }
  if (!startDate || !endDate) {
    return 0;
  }
  const termMonths = computeLeaseTermMonths(startDate, endDate);
  return Math.round(rentAmountGhs * termMonths * 100) / 100;
}
