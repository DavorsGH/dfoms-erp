import { calculateHoursFromClock } from "../hr-payroll/hr-register-utils";

export const CONTRACT_STATUS_OPTIONS = [
  "Active",
  "Expired",
  "Terminated",
  "Pending",
] as const;

export const RISK_LEVEL_OPTIONS = ["Low", "Medium", "High"] as const;

export const PASS_FAIL_OPTIONS = ["Pass", "Fail"] as const;

export const SEVERITY_OPTIONS = ["Low", "Medium", "High"] as const;

export const COMPLAINT_PRIORITY_OPTIONS = ["Low", "Medium", "High"] as const;

export const COMPLAINT_STATUS_OPTIONS = [
  "Open",
  "In Progress",
  "Resolved",
] as const;

export const INCIDENT_STATUS_OPTIONS = [
  "Open",
  "In Progress",
  "Completed",
] as const;

export const INCIDENT_TYPE_OPTIONS = [
  "Blocked Drain",
  "Complaint",
  "Flooding",
  "Missing Items",
  "Other",
] as const;

export const CORRECTIVE_ACTION_STATUS_OPTIONS = [
  "Open",
  "In Progress",
  "Completed",
  "Overdue",
] as const;

export const DEFAULT_CORRECTIVE_ACTION_STATUS = "Open";

export const DEFAULT_COMPLAINT_STATUS = "Open";

export const DEFAULT_INCIDENT_STATUS = "Open";

export const DEFAULT_INSPECTION_PASSING_THRESHOLD = 70;

export function truncateText(
  value: string | null | undefined,
  maxLength = 60,
): string {
  if (!value?.trim()) {
    return "—";
  }

  const trimmed = value.trim();
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}…`
    : trimmed;
}

export function isPastDueDate(
  date: string | null | undefined,
  referenceDate = new Date(),
): boolean {
  if (!date?.trim()) {
    return false;
  }

  const dueDate = new Date(date.slice(0, 10));
  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }

  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );

  return dueDate < today;
}

export function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export function parseOperationsIdNumber(id: string): number {
  const match = id.match(/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function generateNextOperationsId(
  prefix: string,
  padLength: number,
  existingIds: string[],
): string {
  const maxNumber = existingIds.reduce(
    (max, id) => Math.max(max, parseOperationsIdNumber(id)),
    0,
  );

  return `${prefix}${String(maxNumber + 1).padStart(padLength, "0")}`;
}

export function isContractRenewalDue(
  contractEnd: string | null | undefined,
  referenceDate = new Date(),
): boolean {
  if (!contractEnd?.trim()) {
    return false;
  }

  const endDate = new Date(contractEnd.slice(0, 10));
  if (Number.isNaN(endDate.getTime())) {
    return false;
  }

  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  const diffMs = endDate.getTime() - today.getTime();
  const daysUntilEnd = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return daysUntilEnd <= 30;
}

export function isContractExpired(
  contractEnd: string | null | undefined,
  referenceDate = new Date(),
): boolean {
  if (!contractEnd?.trim()) {
    return false;
  }

  const endDate = new Date(contractEnd.slice(0, 10));
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );

  return endDate < today;
}

export function calculateDurationMinutes(
  startTime: string | null | undefined,
  completionTime: string | null | undefined,
): number | null {
  if (!startTime?.trim() || !completionTime?.trim()) {
    return null;
  }

  const hours = calculateHoursFromClock(
    startTime.slice(0, 5),
    completionTime.slice(0, 5),
  );

  if (hours == null) {
    return null;
  }

  return Math.round(hours * 60);
}

export function derivePassFailFromScore(
  inspectionScorePct: number | null | undefined,
  threshold = DEFAULT_INSPECTION_PASSING_THRESHOLD,
): string | null {
  if (
    inspectionScorePct == null ||
    Number.isNaN(Number(inspectionScorePct))
  ) {
    return null;
  }

  return Number(inspectionScorePct) >= threshold ? "Pass" : "Fail";
}

export function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function nullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export function nullableInteger(value: string): number | null {
  const parsed = nullableNumber(value);
  return parsed == null ? null : Math.round(parsed);
}
