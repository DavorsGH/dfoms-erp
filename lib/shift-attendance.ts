import { buildStaffGroups } from "@/lib/attendance-staff-groups";

/**
 * Timed shifts stored on contract_shift_times. Rotating is an employee
 * setting, not a row in that table. Supervisor is a roster column, not an
 * employees.shift value.
 */
export const SCHEDULE_SHIFTS = [
  "Full Day",
  "Morning",
  "Afternoon",
  "Night",
  "Supervisor",
] as const;

export type ScheduleShift = (typeof SCHEDULE_SHIFTS)[number];

/** Weekend covers Saturday, Sunday, and public holidays. */
export const SCHEDULE_DAY_TYPES = ["weekday", "weekend"] as const;

export type ScheduleDayType = (typeof SCHEDULE_DAY_TYPES)[number];

export const DEFAULT_LATE_GRACE_MINUTES = 30;
export const DEFAULT_EARLY_LEAVE_GRACE_MINUTES = 30;

export const ATTENDANCE_EXCEPTIONS_HREF =
  "/dashboard/hr-payroll/attendance#attendance-exceptions";

const REVIEWED_EXCEPTION_STATUSES = new Set(["full_day", "half_day", "absent"]);

export type ContractProjectRef = {
  project_code: string;
  project_name: string;
  service_contract_id?: string | null;
  is_archived?: boolean | null;
};

export type ContractSiteRef = {
  client_id: string | null;
  project_code: string | null;
};

/** One roster_history row. That table is the dated duty-roster assignment. */
export type RosterCoverage = {
  employee_id: string;
  effective_date: string;
  end_date: string | null;
  shift: string | null;
};

export type ShiftTimeRecord = {
  client_id: string;
  shift: string;
  /** Missing values are weekday rows saved before day types existed. */
  day_type?: ScheduleDayType | null;
  start_time: string;
  end_time: string;
  late_grace_minutes: number | null;
  early_leave_grace_minutes: number | null;
};

export type GracePolicy = {
  late_grace_minutes: number;
  early_leave_grace_minutes: number;
};

export type ExpectedSchedule = {
  clientId: string;
  shift: ScheduleShift;
  dayType: ScheduleDayType;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
};

export type AttendanceScheduleColumns = {
  scheduled_shift: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  scheduled_day_type: ScheduleDayType | null;
  late_minutes: number;
  early_leave_minutes: number | null;
  attendance_status: "Present" | "Late";
  exception_status: "none" | "pending";
};

export function isScheduleShift(
  value: string | null | undefined,
): value is ScheduleShift {
  return (SCHEDULE_SHIFTS as readonly string[]).includes(value ?? "");
}

/** Same rule as isSupervisorEmployee on the duty roster. */
export function isDutyRosterSupervisor(employee: {
  position: string | null;
  shift: string | null;
}): boolean {
  const position = (employee.position ?? "").toLowerCase();
  return position.includes("supervisor") || employee.shift === "Full Day";
}

export function isReviewedException(
  status: string | null | undefined,
): boolean {
  return REVIEWED_EXCEPTION_STATUSES.has(status ?? "");
}

function dayKey(value: string | null | undefined): string {
  return (value ?? "").slice(0, 10);
}

export function shiftTimeDayType(
  value: string | null | undefined,
): ScheduleDayType {
  return value === "weekend" ? "weekend" : "weekday";
}

/**
 * Day type of the session start date. Ghana is GMT year-round, so the
 * calendar date is the Africa/Accra weekday. A public holiday uses the
 * weekend times even when it falls on Wednesday.
 */
export function scheduleDayTypeForDate(
  date: string,
  holidayDates?: Iterable<string>,
): ScheduleDayType {
  const day = dayKey(date);
  for (const holiday of holidayDates ?? []) {
    if (dayKey(holiday) === day) {
      return "weekend";
    }
  }
  const [year, month, dayNum] = day.split("-").map(Number);
  if (!year || !month || !dayNum) {
    return "weekday";
  }
  const weekday = new Date(Date.UTC(year, month - 1, dayNum)).getUTCDay();
  return weekday === 0 || weekday === 6 ? "weekend" : "weekday";
}

/**
 * The customer's id the roster already stores on sites for this contract.
 * One distinct customer is required. None, or more than one, means no schedule.
 */
export function resolveClientIdForContract(input: {
  contractProject: string | null;
  projects: ContractProjectRef[];
  sites: ContractSiteRef[];
}): string | null {
  const code = input.contractProject?.trim() ?? "";
  if (!code) {
    return null;
  }

  const groups = buildStaffGroups(input.projects);
  const group = groups.find((item) => item.projectCodes.includes(code));
  const codes = new Set(group?.projectCodes ?? [code]);
  const clientIds = new Set<string>();
  for (const site of input.sites) {
    const projectCode = site.project_code?.trim() ?? "";
    const clientId = site.client_id?.trim() ?? "";
    if (projectCode && clientId && codes.has(projectCode)) {
      clientIds.add(clientId);
    }
  }
  if (clientIds.size !== 1) {
    return null;
  }
  return [...clientIds][0] ?? null;
}

/**
 * Shift on the roster_history row that covers the date. The latest
 * effective_date wins. A covering row whose shift is still Rotating, or no
 * covering row, means the person was not assigned a timed shift that day.
 */
export function rosterShiftForDate(
  rows: RosterCoverage[],
  employeeId: string,
  date: string,
): ScheduleShift | null {
  const day = dayKey(date);
  const covering = rows.filter((row) => {
    if (row.employee_id !== employeeId) {
      return false;
    }
    const start = dayKey(row.effective_date);
    const end = row.end_date ? dayKey(row.end_date) : "9999-12-31";
    return start !== "" && start <= day && day <= end;
  });
  covering.sort((left, right) =>
    dayKey(right.effective_date).localeCompare(dayKey(left.effective_date)),
  );
  const latest = covering[0];
  if (!latest || !isScheduleShift(latest.shift)) {
    return null;
  }
  return latest.shift;
}

function shiftRowFor(
  rows: ShiftTimeRecord[],
  clientId: string,
  shift: ScheduleShift,
  dayType: ScheduleDayType,
): ShiftTimeRecord | null {
  return (
    rows.find(
      (row) =>
        row.client_id === clientId &&
        row.shift === shift &&
        shiftTimeDayType(row.day_type) === dayType,
    ) ?? null
  );
}

function graceOrPolicy(
  override: number | null | undefined,
  policy: number | null | undefined,
  fallback: number,
): number {
  if (override != null && Number.isFinite(Number(override))) {
    return Number(override);
  }
  if (policy != null && Number.isFinite(Number(policy))) {
    return Number(policy);
  }
  return fallback;
}

export function resolveExpectedSchedule(input: {
  employee: {
    employee_id: string;
    position: string | null;
    shift: string | null;
    contract_project: string | null;
  };
  date: string;
  projects: ContractProjectRef[];
  sites: ContractSiteRef[];
  rosterAssignments: RosterCoverage[];
  shiftTimes: ShiftTimeRecord[];
  gracePolicy: GracePolicy | null;
  holidayDates?: Iterable<string>;
}): ExpectedSchedule | null {
  const dayType = scheduleDayTypeForDate(input.date, input.holidayDates);
  const clientId = resolveClientIdForContract({
    contractProject: input.employee.contract_project,
    projects: input.projects,
    sites: input.sites,
  });
  if (!clientId) {
    return null;
  }

  let shift: ScheduleShift | null = null;
  if (input.employee.shift === "Rotating") {
    shift = rosterShiftForDate(
      input.rosterAssignments,
      input.employee.employee_id,
      input.date,
    );
    if (!shift) {
      return null;
    }
  } else if (
    isDutyRosterSupervisor(input.employee) &&
    shiftRowFor(input.shiftTimes, clientId, "Supervisor", dayType)
  ) {
    shift = "Supervisor";
  } else if (isScheduleShift(input.employee.shift)) {
    shift = input.employee.shift;
  } else {
    return null;
  }

  const times = shiftRowFor(input.shiftTimes, clientId, shift, dayType);
  if (!times?.start_time || !times.end_time) {
    return null;
  }

  const startMinutes = minutesOfDay(times.start_time);
  const endMinutes = minutesOfDay(times.end_time);
  return {
    clientId,
    shift,
    dayType,
    startTime: normalizeClock(times.start_time),
    endTime: normalizeClock(times.end_time),
    crossesMidnight: endMinutes < startMinutes,
    lateGraceMinutes: graceOrPolicy(
      times.late_grace_minutes,
      input.gracePolicy?.late_grace_minutes,
      DEFAULT_LATE_GRACE_MINUTES,
    ),
    earlyLeaveGraceMinutes: graceOrPolicy(
      times.early_leave_grace_minutes,
      input.gracePolicy?.early_leave_grace_minutes,
      DEFAULT_EARLY_LEAVE_GRACE_MINUTES,
    ),
  };
}

export function normalizeClock(value: string): string {
  const [hours = "0", minutes = "0", seconds = "0"] = value.trim().split(":");
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}:${seconds.padStart(2, "0")}`.slice(
    0,
    8,
  );
}

export function timeInputValue(value: string | null | undefined): string {
  if (!value?.trim()) {
    return "";
  }
  return normalizeClock(value).slice(0, 5);
}

export const SHIFT_CLOCK_HOURS = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
] as const;

export const SHIFT_CLOCK_MINUTES = [
  "00",
  "05",
  "10",
  "15",
  "20",
  "25",
  "30",
  "35",
  "40",
  "45",
  "50",
  "55",
] as const;

export type ShiftClockMeridiem = "" | "AM" | "PM";

export type ShiftClockParts = {
  hour: string;
  minute: string;
  meridiem: ShiftClockMeridiem;
};

export function emptyShiftClock(): ShiftClockParts {
  return { hour: "", minute: "", meridiem: "" };
}

export function shiftClockFromTime(value: string | null | undefined): ShiftClockParts {
  const hhmm = timeInputValue(value);
  if (!hhmm) {
    return emptyShiftClock();
  }
  const [hourText, minuteText] = hhmm.split(":");
  const hour24 = Number(hourText);
  const minute = minuteText?.padStart(2, "0") ?? "";
  if (!Number.isFinite(hour24) || !minute) {
    return emptyShiftClock();
  }
  const meridiem: ShiftClockMeridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    hour: String(hour12).padStart(2, "0"),
    minute,
    meridiem,
  };
}

export function shiftClockMinuteOptions(current: string): string[] {
  if (current && !SHIFT_CLOCK_MINUTES.includes(current as (typeof SHIFT_CLOCK_MINUTES)[number])) {
    return [...SHIFT_CLOCK_MINUTES, current].sort();
  }
  return [...SHIFT_CLOCK_MINUTES];
}

/** HH:MM in 24-hour form, or null until hour, minute, and AM/PM are all set. */
export function timeFromShiftClock(parts: ShiftClockParts): string | null {
  if (!parts.hour || !parts.minute || !parts.meridiem) {
    return null;
  }
  let hour = Number(parts.hour);
  if (!Number.isFinite(hour) || hour < 1 || hour > 12) {
    return null;
  }
  if (parts.meridiem === "AM") {
    if (hour === 12) {
      hour = 0;
    }
  } else if (hour !== 12) {
    hour += 12;
  }
  return `${String(hour).padStart(2, "0")}:${parts.minute.padStart(2, "0")}`;
}

export function shiftClockIncomplete(parts: ShiftClockParts): boolean {
  const filled = [parts.hour, parts.minute, parts.meridiem].filter(Boolean).length;
  return filled > 0 && filled < 3;
}

export function formatShiftClockLabel(hhmm: string): string {
  const parts = shiftClockFromTime(hhmm);
  const hour = Number(parts.hour);
  if (!parts.meridiem || !Number.isFinite(hour)) {
    return hhmm;
  }
  return `${hour}:${parts.minute} ${parts.meridiem}`;
}

export type ShiftLengthInfo = {
  minutes: number;
  crossesMidnight: boolean;
  hoursLabel: string;
  warn: boolean;
  lengthLabel: string;
  warningSentence: string;
};

export function formatShiftDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

export function describeShiftLength(
  shift: string,
  startHhmm: string,
  endHhmm: string,
): ShiftLengthInfo | null {
  if (!startHhmm || !endHhmm) {
    return null;
  }
  const start = minutesOfDay(startHhmm);
  const end = minutesOfDay(endHhmm);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  const crossesMidnight = end <= start;
  const minutes = crossesMidnight ? 24 * 60 - start + end : end - start;
  const hoursLabel = formatShiftDuration(minutes);
  const warn = minutes > 14 * 60 || (crossesMidnight && shift !== "Night");
  const lengthLabel = warn
    ? crossesMidnight
      ? `${hoursLabel} · crosses midnight`
      : `${hoursLabel} · long shift`
    : crossesMidnight
      ? `${hoursLabel} · overnight`
      : hoursLabel;
  const clocks = `${shift} ${formatShiftClockLabel(startHhmm)} → ${formatShiftClockLabel(endHhmm)} is ${hoursLabel}`;
  const warningSentence =
    crossesMidnight && shift !== "Night"
      ? `${clocks} and crosses midnight. Only Night shifts usually do that.`
      : `${clocks}. Shifts longer than 14 hours need a check.`;
  return { minutes, crossesMidnight, hoursLabel, warn, lengthLabel, warningSentence };
}

function minutesOfDay(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + days));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * In-memory instant for late/early math. Do not write this into a Postgres
 * `time` column — use `normalizeClock` (HH:MM:SS) for scheduled_start/end.
 */
export function scheduleTimestamp(date: string, time: string): string {
  return `${date.slice(0, 10)}T${normalizeClock(time)}.000Z`;
}

function absoluteMinutes(date: string, time: string): number {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const [hours = 0, minutes = 0] = normalizeClock(time).split(":").map(Number);
  return Date.UTC(year, (month ?? 1) - 1, day ?? 1, hours, minutes) / 60000;
}

/**
 * Stamp scheduled times and lateness onto a device or remote row.
 * Returns null when the row was already reviewed so a reprocess leaves it alone.
 * Within grace, late and early minutes are stored as 0. Beyond grace, the
 * stored value is the actual minutes, and exception_status becomes pending.
 */
export function attendanceScheduleColumns(input: {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  schedule: ExpectedSchedule | null;
  dayType?: ScheduleDayType | null;
  existingExceptionStatus?: string | null;
  /**
   * Attendance mode "exempt": never late, never left early, never a pending
   * exception. The schedule is not stamped because nothing is measured.
   */
  exempt?: boolean;
}): AttendanceScheduleColumns | null {
  if (isReviewedException(input.existingExceptionStatus)) {
    return null;
  }

  const schedule = input.exempt ? null : input.schedule;
  const dayType =
    (input.exempt ? null : input.schedule?.dayType) ?? input.dayType ?? null;
  if (!schedule) {
    return {
      scheduled_shift: null,
      scheduled_start: null,
      scheduled_end: null,
      scheduled_day_type: dayType,
      late_minutes: 0,
      early_leave_minutes: input.clockOut ? 0 : null,
      attendance_status: "Present",
      exception_status: "none",
    };
  }

  const startDate = input.date.slice(0, 10);
  const endDate = schedule.crossesMidnight ? addDays(startDate, 1) : startDate;
  // attendance_register.scheduled_start/end are `time`. Persist the Africa/Accra
  // shift clock, and keep the calendar dates only for the minute math below.
  const scheduledStart = normalizeClock(schedule.startTime);
  const scheduledEnd = normalizeClock(schedule.endTime);

  let lateMinutes = 0;
  if (input.clockIn) {
    const late = Math.max(
      0,
      absoluteMinutes(startDate, input.clockIn) -
        absoluteMinutes(startDate, schedule.startTime),
    );
    lateMinutes = late > schedule.lateGraceMinutes ? late : 0;
  }

  let earlyLeaveMinutes: number | null = null;
  if (input.clockOut) {
    const clockInMinutes = input.clockIn
      ? minutesOfDay(input.clockIn)
      : minutesOfDay(schedule.startTime);
    const clockOutDate =
      minutesOfDay(input.clockOut) < clockInMinutes
        ? addDays(startDate, 1)
        : startDate;
    const early = Math.max(
      0,
      absoluteMinutes(endDate, schedule.endTime) -
        absoluteMinutes(clockOutDate, input.clockOut),
    );
    earlyLeaveMinutes = early > schedule.earlyLeaveGraceMinutes ? early : 0;
  }

  const pending = lateMinutes > 0 || (earlyLeaveMinutes ?? 0) > 0;
  return {
    scheduled_shift: schedule.shift,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    scheduled_day_type: dayType,
    late_minutes: lateMinutes,
    early_leave_minutes: earlyLeaveMinutes,
    attendance_status: lateMinutes > 0 ? "Late" : "Present",
    exception_status: pending ? "pending" : "none",
  };
}

export function formatMinuteSpan(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const mins = whole % 60;
  if (hours <= 0) {
    return `${mins}m`;
  }
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

export function lateByLabel(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) {
    return null;
  }
  return `Late by ${formatMinuteSpan(minutes)}`;
}

export function leftEarlyLabel(
  minutes: number | null | undefined,
): string | null {
  if (!minutes || minutes <= 0) {
    return null;
  }
  return `Left early by ${formatMinuteSpan(minutes)}`;
}

export function attendanceExceptionBadges(row: {
  late_minutes?: number | null;
  early_leave_minutes?: number | null;
  exception_status?: string | null;
}): string[] {
  const status = row.exception_status ?? "none";
  if (status === "half_day") {
    return ["Half day"];
  }
  if (status === "full_day") {
    return ["Full day"];
  }
  if (status === "absent") {
    return ["Absent"];
  }
  const badges: string[] = [];
  if ((row.late_minutes ?? 0) > 0) {
    badges.push(`Late ${formatMinuteSpan(row.late_minutes ?? 0)}`);
  }
  if ((row.early_leave_minutes ?? 0) > 0) {
    badges.push(`Left early ${formatMinuteSpan(row.early_leave_minutes ?? 0)}`);
  }
  if (status === "pending") {
    badges.push("Pending");
  }
  return badges;
}

export function formatScheduleClock(value: string | null | undefined): string {
  if (!value?.trim()) {
    return "—";
  }
  if (value.includes("T")) {
    return value.slice(11, 16);
  }
  return value.slice(0, 5);
}

export function attendanceExceptionsReviewHref(year: number, month: number): string {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    exceptions: "pending",
  });
  return `/dashboard/hr-payroll/attendance?${params.toString()}#attendance-exceptions`;
}

export function pendingExceptionLockRefusal(
  count: number,
  period?: { year: number; month: number },
): {
  error: string;
  pendingExceptionCount: number;
  exceptionsHref: string;
} | null {
  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }
  const label =
    count === 1
      ? "1 attendance exception is"
      : `${count} attendance exceptions are`;
  return {
    error: `${label} still pending for this month. Review them before locking payroll.`,
    pendingExceptionCount: count,
    exceptionsHref:
      period && period.year > 0 && period.month > 0
        ? attendanceExceptionsReviewHref(period.year, period.month)
        : ATTENDANCE_EXCEPTIONS_HREF,
  };
}

export class PendingAttendanceExceptionsError extends Error {
  readonly count: number;
  readonly href: string;

  constructor(refusal: {
    error: string;
    pendingExceptionCount: number;
    exceptionsHref: string;
  }) {
    super(refusal.error);
    this.name = "PendingAttendanceExceptionsError";
    this.count = refusal.pendingExceptionCount;
    this.href = refusal.exceptionsHref;
  }
}
