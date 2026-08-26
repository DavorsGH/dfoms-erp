export type LesseeComplaintStatus =
  | "submitted"
  | "in_progress"
  | "resolved"
  | "rejected";

export type LesseeComplaintRaisedBy = "tenant" | "landlord" | "facility_manager";

export type LesseeComplaintListRow = {
  complaintId: string;
  tenantId: string;
  leaseId: string;
  lesseeId: string;
  lesseeName: string;
  unitLabel: string;
  subject: string;
  description: string;
  status: LesseeComplaintStatus;
  raisedBy: LesseeComplaintRaisedBy;
  staffResponse: string | null;
  dateReported: string;
  dateResolved: string | null;
  tenantAcknowledgedAt: string | null;
};

export const LESSEE_COMPLAINT_STATUS_OPTIONS: Array<{
  value: LesseeComplaintStatus;
  label: string;
}> = [
  { value: "submitted", label: "Submitted" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
];

export function isLesseeComplaintStatus(
  value: string,
): value is LesseeComplaintStatus {
  return LESSEE_COMPLAINT_STATUS_OPTIONS.some(
    (option) => option.value === value,
  );
}

export function isLesseeComplaintRaisedBy(
  value: string,
): value is LesseeComplaintRaisedBy {
  return (
    value === "tenant" ||
    value === "landlord" ||
    value === "facility_manager"
  );
}

/** Landlord or FM filed about the tenant — tenant may respond in lessee portal. */
export function isLesseeComplaintTenantRespondable(
  value: LesseeComplaintRaisedBy,
): boolean {
  return value === "landlord" || value === "facility_manager";
}

export function formatLesseeComplaintRaisedBy(
  value: LesseeComplaintRaisedBy,
): string {
  if (value === "landlord") {
    return "From landlord";
  }
  if (value === "facility_manager") {
    return "From Facility Manager";
  }
  return "From tenant";
}

export function formatLesseeComplaintStatus(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }
  const match = LESSEE_COMPLAINT_STATUS_OPTIONS.find(
    (option) => option.value === value,
  );
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatLesseeComplaintDate(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
