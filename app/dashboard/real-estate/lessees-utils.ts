import type { InspectionListRow } from "./inspections-utils";
import type { MaintenanceListRow } from "./maintenance-utils";
import type { RentLedgerListRow } from "./rent-ledger-utils";

export type LesseeStatus = "active" | "former";

export type LesseeListRow = {
  lesseeId: string;
  tenantId: string;
  fullName: string;
  phone: string;
  email: string | null;
  status: LesseeStatus;
  privateNotes: string | null;
  createdAt: string;
};

export type LesseeActiveLeaseSummary = {
  leaseId: string;
  unitId: string;
  unitNumber: string;
  propertyId: string | null;
  propertyName: string;
  startDate: string;
  endDate: string;
  rentAmountGhs: number;
  status: string;
};

export type LesseeDepositSummary = {
  depositId: string;
  leaseId: string;
  unitLabel: string;
  amountGhs: number;
  status: string;
  amountReturnedGhs: number | null;
  dateCollected: string;
  dateResolved: string | null;
  resolutionNotes: string | null;
};

export type LesseeDetail = {
  lesseeId: string;
  tenantId: string;
  landlordName: string;
  fullName: string;
  phone: string;
  email: string | null;
  status: LesseeStatus;
  privateNotes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Profile photo of the lessee (person), not the property. */
  photoUrl: string | null;
  /** Primary/first property photo for the active lease’s property (or null). */
  propertyHeroPhotoUrl: string | null;
  propertyHeroPropertyId: string | null;
  propertyHeroPropertyName: string | null;
  activeLease: LesseeActiveLeaseSummary | null;
  leases: LesseeActiveLeaseSummary[];
  deposits: LesseeDepositSummary[];
  rentLedger: RentLedgerListRow[];
  maintenance: MaintenanceListRow[];
  inspections: InspectionListRow[];
};

export const LESSEE_STATUS_OPTIONS: Array<{
  value: LesseeStatus;
  label: string;
}> = [
  { value: "active", label: "Active" },
  { value: "former", label: "Former" },
];

export function formatLesseeStatus(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const match = LESSEE_STATUS_OPTIONS.find((option) => option.value === value);
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatLesseeDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function isLesseeStatus(value: string): value is LesseeStatus {
  return LESSEE_STATUS_OPTIONS.some((option) => option.value === value);
}
