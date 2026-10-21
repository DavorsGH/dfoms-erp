import { exceptionDecisionLabel } from "@/lib/attendance-exception-decision";
import { formatMinuteSpan } from "@/lib/shift-attendance";
import type { AttendanceRegisterEntry } from "../hr-payroll/attendance-register-utils";

export type AttendanceContractRef = {
  project_code: string;
  project_name: string;
};

export type AttendanceDayKind =
  | "present"
  | "late"
  | "absent"
  | "half_day"
  | "leave"
  | "empty";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export function matchAttendanceProject(
  value: string | null | undefined,
  projects: AttendanceContractRef[],
): AttendanceContractRef | null {
  const key = norm(value ?? "");
  if (!key) {
    return null;
  }
  return (
    projects.find((project) => norm(project.project_code) === key) ??
    projects.find((project) => norm(project.project_name) === key) ??
    null
  );
}

/**
 * A stored assignment that names a contract stays on that contract.
 * A value that is not a contract (a position title such as "Field Manager")
 * uses the employee's contract instead.
 */
export function attendanceContractLabel(input: {
  projectAssignment: string | null | undefined;
  employeeContract: string | null | undefined;
  projects: AttendanceContractRef[];
}): string {
  const fromRow = matchAttendanceProject(input.projectAssignment, input.projects);
  const source = fromRow
    ? fromRow
    : matchAttendanceProject(input.employeeContract, input.projects);
  if (!source) {
    return "—";
  }
  return `${source.project_name} / ${source.project_code}`;
}

export function formatAttendanceClock(value: string | null | undefined): string {
  const match = value?.trim().match(/(\d{2}):(\d{2})/);
  if (!match) {
    return "—";
  }
  return `${match[1]}:${match[2]}`;
}

export function formatAttendanceHours(value: number | null | undefined): string | null {
  if (value == null || Number.isNaN(Number(value))) {
    return null;
  }
  const rounded = Math.round(Number(value) * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} h`;
}

export function formatAttendanceHoursTotal(values: number[]): string {
  const total = Math.round(values.reduce((sum, value) => sum + value, 0) * 10) / 10;
  return Number.isInteger(total) ? String(total) : total.toFixed(1);
}

export function attendanceDayKind(
  entry: Pick<AttendanceRegisterEntry, "attendance_status" | "exception_status"> | null,
): AttendanceDayKind {
  if (!entry) {
    return "empty";
  }
  const status = entry.attendance_status.trim().toLowerCase();
  if (
    status === "holiday" ||
    status === "on leave" ||
    status === "leave" ||
    status.includes("leave")
  ) {
    return "leave";
  }
  if (entry.exception_status === "half_day") {
    return "half_day";
  }
  if (entry.exception_status === "absent" || status === "absent") {
    return "absent";
  }
  if (status === "late") {
    return "late";
  }
  if (status === "present") {
    return "present";
  }
  return "empty";
}

export function attendanceStatusLabel(kind: AttendanceDayKind, rawStatus?: string): string {
  switch (kind) {
    case "present":
      return "Present";
    case "late":
      return "Late";
    case "absent":
      return "Absent";
    case "half_day":
      return "Half day";
    case "leave":
      return rawStatus?.trim() || "Leave";
    default:
      return "No record";
  }
}

export function attendanceExceptionLine(
  entry: Pick<
    AttendanceRegisterEntry,
    "late_minutes" | "early_leave_minutes" | "exception_status"
  >,
): string | null {
  const parts: string[] = [];
  if ((entry.late_minutes ?? 0) > 0) {
    parts.push(`Late ${formatMinuteSpan(entry.late_minutes ?? 0)}`);
  }
  if ((entry.early_leave_minutes ?? 0) > 0) {
    parts.push(`Left early ${formatMinuteSpan(entry.early_leave_minutes ?? 0)}`);
  }
  const decision = entry.exception_status;
  if (decision === "half_day" || decision === "full_day" || decision === "absent") {
    parts.push(exceptionDecisionLabel(decision));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type MonthParts = { year: number; month: number };

export function monthPartsFromIso(isoDate: string): MonthParts {
  const [year, month] = isoDate.slice(0, 10).split("-").map(Number);
  return { year: year || 1970, month: month || 1 };
}

export function shiftMonth(parts: MonthParts, delta: number): MonthParts {
  const index = parts.year * 12 + (parts.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Today when it falls in the month; otherwise the earliest recorded day, then the 1st. */
export function selectionForMonth(
  month: MonthParts,
  today: string,
  recordedDates: string[],
): string {
  const prefix = `${month.year}-${String(month.month).padStart(2, "0")}`;
  if (today.startsWith(prefix)) {
    return today;
  }
  const recorded = recordedDates
    .map((date) => date.slice(0, 10))
    .filter((date) => date.startsWith(prefix))
    .sort();
  return recorded[0] ?? isoDate(month.year, month.month, 1);
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Monday-first offset for the 1st. 0 = Monday. */
export function mondayIndex(year: number, month: number, day: number): number {
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (utcDay + 6) % 7;
}

export function formatMonthTitle(parts: MonthParts): string {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, 1));
  return date.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatAttendanceDay(isoDate: string, withYear: boolean): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) {
    return "—";
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  const weekday = WEEKDAYS[utc.getUTCDay()];
  const monthName = MONTHS[month - 1];
  return withYear
    ? `${weekday} ${day} ${monthName} ${year}`
    : `${weekday} ${day} ${monthName}`;
}

export function formatDayMonth(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) {
    return "—";
  }
  return `${day} ${MONTHS[month - 1]}`;
}

export type AttendanceWeek = {
  week: number;
  dates: string[];
  label: string;
};

export function buildMonthWeeks(parts: MonthParts): AttendanceWeek[] {
  const count = daysInMonth(parts.year, parts.month);
  const weeks: AttendanceWeek[] = [];
  let dates: string[] = [];
  for (let day = 1; day <= count; day += 1) {
    dates.push(isoDate(parts.year, parts.month, day));
    const isSunday = mondayIndex(parts.year, parts.month, day) === 6;
    if (isSunday || day === count) {
      const start = dates[0] ?? "";
      const end = dates[dates.length - 1] ?? "";
      const startLabel = formatDayMonth(start);
      const endLabel = formatDayMonth(end);
      weeks.push({
        week: weeks.length + 1,
        dates,
        label:
          start === end
            ? `Week ${weeks.length + 1} · ${startLabel}`
            : `Week ${weeks.length + 1} · ${startLabel.replace(/ [A-Za-z]+$/, "")}–${endLabel}`,
      });
      dates = [];
    }
  }
  return weeks;
}

export function weekSummary(
  kinds: AttendanceDayKind[],
): string {
  const counts = {
    present: 0,
    late: 0,
    absent: 0,
    half_day: 0,
    leave: 0,
  };
  for (const kind of kinds) {
    if (kind === "empty") {
      continue;
    }
    counts[kind] += 1;
  }
  const parts = [
    counts.present ? `${counts.present} present` : "",
    counts.late ? `${counts.late} late` : "",
    counts.absent ? `${counts.absent} absent` : "",
    counts.half_day ? `${counts.half_day} half day` : "",
    counts.leave ? `${counts.leave} holiday` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
