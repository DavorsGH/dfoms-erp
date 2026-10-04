export const OVERTIME_DAY_TYPE_NORMAL = "normal_working_day";
export const OVERTIME_DAY_TYPE_REST = "rest_day_weekend_holiday";

export type OvertimeDayType =
  | typeof OVERTIME_DAY_TYPE_NORMAL
  | typeof OVERTIME_DAY_TYPE_REST;

export function displayOvertimeDayType(
  dayType: string | null | undefined,
): string {
  if (dayType === OVERTIME_DAY_TYPE_REST) {
    return "Rest day / weekend / public holiday";
  }
  return "Normal working day";
}

export function normalizeOvertimeDayType(
  value: unknown,
): OvertimeDayType | null {
  const raw = String(value ?? "").trim();
  if (raw === OVERTIME_DAY_TYPE_REST) {
    return OVERTIME_DAY_TYPE_REST;
  }
  if (raw === OVERTIME_DAY_TYPE_NORMAL || raw === "") {
    return OVERTIME_DAY_TYPE_NORMAL;
  }
  return null;
}

export type OvertimeEntryFieldErrors = {
  date?: string;
  employee_ids?: string;
  hours_worked?: string;
  overtime_hours?: string;
  overtime_rate?: string;
  approved_by?: string;
  day_type?: string;
};

export type OvertimeEntryInput = {
  date: string;
  hours_worked: number;
  overtime_hours: number;
  overtime_rate: number;
  approved_by: string;
  day_type: OvertimeDayType;
};

function parsePositiveHours(value: number, label: string): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return `${label} must be greater than 0.`;
  }
  if (value > 24) {
    return `${label} can't be more than 24.`;
  }
  return null;
}

export function validateOvertimeEntryInput(
  input: OvertimeEntryInput,
): OvertimeEntryFieldErrors {
  const errors: OvertimeEntryFieldErrors = {};

  if (!input.date.trim()) {
    errors.date = "Date is required.";
  }

  if (!input.approved_by.trim()) {
    errors.approved_by = "Approved By is required.";
  }

  if (!input.day_type) {
    errors.day_type = "Day type is required.";
  }

  const hoursWorkedError = parsePositiveHours(
    input.hours_worked,
    "Hours worked",
  );
  if (hoursWorkedError) {
    errors.hours_worked = hoursWorkedError;
  }

  const overtimeHoursError = parsePositiveHours(
    input.overtime_hours,
    "Overtime hours",
  );
  if (overtimeHoursError) {
    errors.overtime_hours = overtimeHoursError;
  } else if (
    Number.isFinite(input.hours_worked) &&
    input.hours_worked > 0 &&
    input.overtime_hours > input.hours_worked
  ) {
    errors.overtime_hours =
      "Overtime hours can't be more than hours worked.";
  }

  if (!Number.isFinite(input.overtime_rate) || input.overtime_rate <= 0) {
    errors.overtime_rate = "Overtime rate must be greater than 0.";
  }

  return errors;
}

export function hasOvertimeFieldErrors(
  errors: OvertimeEntryFieldErrors,
): boolean {
  return Object.keys(errors).length > 0;
}

export function firstOvertimeFieldError(
  errors: OvertimeEntryFieldErrors,
): string | null {
  for (const value of Object.values(errors)) {
    if (value) {
      return value;
    }
  }
  return null;
}
