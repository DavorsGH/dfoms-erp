export type RentalApplicationStatus =
  | "submitted"
  | "under_review"
  | "info_requested"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "closed";

export const RENTAL_APPLICATION_STATUS_OPTIONS: Array<{
  value: RentalApplicationStatus;
  label: string;
}> = [
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under review" },
  { value: "info_requested", label: "Info requested" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "closed", label: "Closed" },
];

export function isRentalApplicationStatus(
  value: string,
): value is RentalApplicationStatus {
  return RENTAL_APPLICATION_STATUS_OPTIONS.some(
    (option) => option.value === value,
  );
}

export function formatRentalApplicationStatus(
  value: string | null | undefined,
): string {
  if (!value) return "—";
  const match = RENTAL_APPLICATION_STATUS_OPTIONS.find(
    (option) => option.value === value,
  );
  return match?.label ?? value.replace(/_/g, " ");
}

export type RentalApplicationListRow = {
  applicationId: string;
  tenantId: string;
  landlordName: string;
  propertyId: string;
  propertyName: string;
  unitId: string;
  unitNumber: string;
  fullName: string;
  email: string | null;
  phone: string;
  status: RentalApplicationStatus;
  desiredMoveIn: string | null;
  monthlyIncomeGhs: number | null;
  createdAt: string;
  decidedAt: string | null;
  leaseId: string | null;
};

export type RentalApplicationDetail = {
  applicationId: string;
  tenantId: string;
  landlordName: string;
  landlordType: string | null;
  propertyId: string;
  propertyName: string;
  unitId: string;
  unitNumber: string;
  unitStatus: string | null;
  baseRentGhs: number | null;
  fullName: string;
  email: string | null;
  phone: string;
  nationalId: string | null;
  desiredMoveIn: string | null;
  householdSize: number | null;
  hasPets: boolean;
  petDetails: string | null;
  employerName: string | null;
  jobTitle: string | null;
  monthlyIncomeGhs: number | null;
  employmentNotes: string | null;
  referencesText: string | null;
  idDocumentUrls: string[];
  consentAccuracy: boolean;
  consentBackgroundCheck: boolean;
  consentedAt: string | null;
  status: RentalApplicationStatus;
  landlordNotes: string | null;
  infoRequestMessage: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  lesseeId: string | null;
  leaseId: string | null;
  createdAt: string;
  updatedAt: string;
};

export function formatApplicationDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatApplicationMoney(
  value: number | null | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
