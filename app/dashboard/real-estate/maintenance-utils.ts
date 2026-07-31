export type MaintenanceReportedBy = "staff" | "tenant";
export type MaintenanceStatus =
  | "submitted"
  | "approved"
  | "in_progress"
  | "completed"
  | "rejected";
export type MaintenanceLandlordApprovalStatus =
  | "pending"
  | "approved"
  | "rejected";

export type MaintenanceListRow = {
  requestId: string;
  tenantId: string;
  leaseId: string;
  lesseeName: string;
  unitLabel: string;
  description: string;
  status: MaintenanceStatus;
  costGhs: number | null;
  landlordApprovalStatus: MaintenanceLandlordApprovalStatus;
  dateReported: string;
  dateResolved: string | null;
  reportedBy: MaintenanceReportedBy;
  photoUrls: string[];
};

export type ActiveLeaseOption = {
  leaseId: string;
  label: string;
};

export const MAINTENANCE_STATUS_OPTIONS: Array<{
  value: MaintenanceStatus;
  label: string;
}> = [
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "rejected", label: "Rejected" },
];

export const LANDLORD_APPROVAL_STATUS_OPTIONS: Array<{
  value: MaintenanceLandlordApprovalStatus;
  label: string;
}> = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export function isMaintenanceStatus(
  value: string,
): value is MaintenanceStatus {
  return MAINTENANCE_STATUS_OPTIONS.some((option) => option.value === value);
}

export function isLandlordApprovalStatus(
  value: string,
): value is MaintenanceLandlordApprovalStatus {
  return LANDLORD_APPROVAL_STATUS_OPTIONS.some(
    (option) => option.value === value,
  );
}

export function isMaintenanceReportedBy(
  value: string,
): value is MaintenanceReportedBy {
  return value === "staff" || value === "tenant";
}

export function formatMaintenanceStatus(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }
  const match = MAINTENANCE_STATUS_OPTIONS.find(
    (option) => option.value === value,
  );
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatMaintenanceLandlordApproval(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }
  const match = LANDLORD_APPROVAL_STATUS_OPTIONS.find(
    (option) => option.value === value,
  );
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatMaintenanceMoney(
  value: number | null | undefined,
): string {
  if (value == null || !Number.isFinite(Number(value))) {
    return "—";
  }
  return `GHS ${Number(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatMaintenanceDate(
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
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export { normalizePhotoUrls } from "./properties-utils";
