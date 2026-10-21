import { buildReportYearOptions } from "../reports/report-period-utils";

export type AttendanceRegisterEntry = {
  id: string;
  date: string;
  staff_id: string;
  employment_type: string | null;
  project_assignment: string | null;
  clock_in: string | null;
  clock_out: string | null;
  hours_worked: number | null;
  overtime_hours: number | null;
  attendance_status: string;
  scheduled_shift?: string | null;
  scheduled_day_type?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  late_minutes?: number | null;
  early_leave_minutes?: number | null;
  exception_status?: string | null;
  /** Site code from the device/remote clock when recorded. */
  site_code?: string | null;
  /** e.g. "remote" for remote clock-ins (status stays Present). */
  source?: string | null;
};

export const ATTENDANCE_STATUS_OPTIONS = [
  "Present",
  "Absent",
  "Late",
  "On Leave",
] as const;

export const DEFAULT_ATTENDANCE_STATUS = "Present";

export const ATTENDANCE_MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
] as const;

/** Calendar year options for the attendance filter. */
export function buildAttendanceYearOptions(
  _referenceDate: Date = new Date(),
): number[] {
  return buildReportYearOptions([]);
}

export function getAttendanceMonthBounds(
  year: number,
  month: number,
): { start: string; end: string } {
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

/** Prefer today when it falls in the selected month; otherwise the 1st of that month. */
export function defaultAttendanceDateForMonth(
  year: number,
  month: number,
  referenceDate: Date = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  if (
    referenceDate.getFullYear() === year &&
    referenceDate.getMonth() + 1 === month
  ) {
    return `${year}-${pad(month)}-${pad(referenceDate.getDate())}`;
  }
  return `${year}-${pad(month)}-01`;
}
