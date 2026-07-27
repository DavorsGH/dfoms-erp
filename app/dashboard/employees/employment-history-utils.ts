import type { EmployeeRecord } from "./employee-record-utils";
import { DEFAULT_EMPLOYMENT_STATUS } from "./employee-record-utils";

export const EMPLOYMENT_HISTORY_SELECT =
  "history_id, employee_id, effective_date, employment_type, position, shift, department, rate_id, basic_salary, housing_allowance, transport_allowance, other_allowances, employee_status, change_reason, changed_by, changed_at";

export type EmploymentHistoryEntry = {
  history_id: string;
  employee_id: string;
  effective_date: string;
  employment_type: string;
  position: string | null;
  shift: string | null;
  department: string | null;
  rate_id: string | null;
  basic_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: number;
  employee_status: string;
  change_reason: string | null;
  changed_by: string | null;
  changed_at: string;
};

export type TrackedEmploymentSnapshot = {
  position: string | null;
  department: string | null;
  shift: string | null;
  employment_status: string;
  employment_type: string;
  basic_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: number;
};

/** Payload shape from buildPayload relevant to employment history. */
export type EmploymentHistorySource = {
  position?: string | null;
  department?: string | null;
  shift?: string | null;
  employment_status?: string | null;
  employment_type?: string | null;
  basic_salary?: number | null;
  housing_allowance?: number | null;
  transport_allowance?: number | null;
  other_allowances?: number | null;
};

export function normalizeHistoryText(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

export function normalizeHistoryMoney(
  value: number | string | null | undefined,
): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.round(parsed * 100) / 100;
}

export function snapshotFromEmployee(
  employee: Pick<
    EmployeeRecord,
    | "position"
    | "department"
    | "shift"
    | "employment_status"
    | "employment_type"
    | "basic_salary"
    | "housing_allowance"
    | "transport_allowance"
    | "other_allowances"
  >,
): TrackedEmploymentSnapshot {
  return {
    position: normalizeHistoryText(employee.position),
    department: normalizeHistoryText(employee.department),
    shift: normalizeHistoryText(employee.shift),
    employment_status:
      normalizeHistoryText(employee.employment_status) ??
      DEFAULT_EMPLOYMENT_STATUS,
    employment_type: normalizeHistoryText(employee.employment_type) ?? "",
    basic_salary: normalizeHistoryMoney(employee.basic_salary),
    housing_allowance: normalizeHistoryMoney(employee.housing_allowance),
    transport_allowance: normalizeHistoryMoney(employee.transport_allowance),
    other_allowances: normalizeHistoryMoney(employee.other_allowances),
  };
}

export function snapshotFromPayload(
  payload: EmploymentHistorySource,
): TrackedEmploymentSnapshot {
  return {
    position: normalizeHistoryText(payload.position),
    department: normalizeHistoryText(payload.department),
    shift: normalizeHistoryText(payload.shift),
    employment_status:
      normalizeHistoryText(payload.employment_status) ??
      DEFAULT_EMPLOYMENT_STATUS,
    employment_type: normalizeHistoryText(payload.employment_type) ?? "",
    basic_salary: normalizeHistoryMoney(payload.basic_salary),
    housing_allowance: normalizeHistoryMoney(payload.housing_allowance),
    transport_allowance: normalizeHistoryMoney(payload.transport_allowance),
    other_allowances: normalizeHistoryMoney(payload.other_allowances),
  };
}

export function hasTrackedEmploymentChange(
  before: TrackedEmploymentSnapshot,
  after: TrackedEmploymentSnapshot,
): boolean {
  return (
    before.position !== after.position ||
    before.department !== after.department ||
    before.shift !== after.shift ||
    before.employment_status !== after.employment_status ||
    before.employment_type !== after.employment_type ||
    before.basic_salary !== after.basic_salary ||
    before.housing_allowance !== after.housing_allowance ||
    before.transport_allowance !== after.transport_allowance ||
    before.other_allowances !== after.other_allowances
  );
}

export function todayEffectiveDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildEmploymentHistoryInsert(input: {
  employeeId: string;
  snapshot: TrackedEmploymentSnapshot;
  changeReason: string | null;
  changedBy: string;
  effectiveDate?: string;
}) {
  return {
    employee_id: input.employeeId,
    effective_date: input.effectiveDate ?? todayEffectiveDate(),
    employment_type: input.snapshot.employment_type || "Unknown",
    position: input.snapshot.position,
    shift: input.snapshot.shift,
    department: input.snapshot.department,
    rate_id: null,
    basic_salary: input.snapshot.basic_salary,
    housing_allowance: input.snapshot.housing_allowance,
    transport_allowance: input.snapshot.transport_allowance,
    other_allowances: input.snapshot.other_allowances,
    employee_status: input.snapshot.employment_status,
    change_reason: input.changeReason,
    changed_by: input.changedBy,
  };
}
