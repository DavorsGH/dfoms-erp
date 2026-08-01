export type LesseeComplaintStatus =
  | "submitted"
  | "in_progress"
  | "resolved"
  | "rejected";

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
  staffResponse: string | null;
  dateReported: string;
  dateResolved: string | null;
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
