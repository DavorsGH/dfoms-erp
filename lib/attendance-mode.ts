/**
 * R23 attendance modes and remote work arrangements.
 *
 * Pure helpers only (no server imports) so they run in the browser, API routes
 * and `npx tsx` tests. Weekdays follow ISO 8601 (Mon = 1 … Sun = 7), matching
 * `remote_work_arrangements.weekdays`.
 *
 * Schema note: arrangements are date-ranged (`start_date` / `end_date`), not
 * time-ranged. An arrangement covers a whole day when it is active, the date
 * falls inside the range and the ISO weekday is listed.
 */

import { formatDate } from "@/app/dashboard/finance/income-register-utils";

export const ATTENDANCE_MODES = ["exempt", "quick_remote", "standard"] as const;

export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

export const ATTENDANCE_MODE_LABELS: Record<AttendanceMode, string> = {
  exempt: "Exempt",
  quick_remote: "Quick remote",
  standard: "Standard",
};

export const EXEMPT_ATTENDANCE_MESSAGE = "Attendance not required for your role.";
export const ARRANGEMENT_APPROVAL_NOTE =
  "Approved by your remote work arrangement";
export const QUICK_REMOTE_APPROVAL_NOTE =
  "Auto-approved (quick remote attendance)";
export const DEFAULT_ARRANGEMENT_REASON = "Remote work arrangement";

/** Column list for `remote_work_arrangements` selects. */
export const ARRANGEMENT_COLUMNS =
  "id, tenant_id, staff_id, weekdays, start_date, end_date, location_note, reason, auto_approve, is_active, approved_by, created_by, created_at, updated_at";

export const ISO_WEEKDAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 7, short: "Sun", long: "Sunday" },
] as const;

export type RemoteWorkArrangement = {
  id: string;
  tenant_id: string;
  staff_id: string;
  weekdays: number[];
  start_date: string;
  end_date: string | null;
  location_note: string;
  reason: string;
  auto_approve: boolean;
  is_active: boolean;
  approved_by?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

/** Fields needed to test coverage and overlap. */
export type ArrangementWindow = Pick<
  RemoteWorkArrangement,
  "weekdays" | "start_date" | "end_date" | "is_active"
>;

export type ArrangementDraft = {
  id?: string | null;
  tenant_id: string;
  staff_id: string;
  weekdays: number[];
  start_date: string;
  end_date: string | null;
  is_active: boolean;
};

/** Matches the RLS write policy: super_admin, director, hr. */
export const ATTENDANCE_MODE_EDIT_ROLES = ["super_admin", "director", "hr"] as const;

export function canManageRemoteWorkArrangements(
  role: string | null | undefined,
): boolean {
  return (ATTENDANCE_MODE_EDIT_ROLES as readonly string[]).includes(role ?? "");
}

export function isAttendanceMode(value: unknown): value is AttendanceMode {
  return (
    typeof value === "string" &&
    (ATTENDANCE_MODES as readonly string[]).includes(value)
  );
}

/** Role default when `employees.attendance_mode` is NULL. */
export function roleDefaultAttendanceMode(
  role: string | null | undefined,
): AttendanceMode {
  switch (role) {
    case "super_admin":
    case "director":
      return "exempt";
    case "hr":
    case "finance":
    case "finance_admin":
    case "operations_manager":
      return "quick_remote";
    default:
      return "standard";
  }
}

/** Override beats role default. Invalid or empty override falls back to the role. */
export function resolveAttendanceMode(
  employee: { attendance_mode?: string | null } | null | undefined,
  role: string | null | undefined,
): AttendanceMode {
  const override = employee?.attendance_mode?.trim();
  if (isAttendanceMode(override)) {
    return override;
  }
  return roleDefaultAttendanceMode(role);
}

export function isExemptMode(mode: AttendanceMode | null | undefined): boolean {
  return mode === "exempt";
}

export function attendanceModeLabel(mode: AttendanceMode): string {
  return ATTENDANCE_MODE_LABELS[mode];
}

/** Label for the "Role default (X)" select option. */
export function roleDefaultOptionLabel(role: string | null | undefined): string {
  if (!role) {
    return "Role default";
  }
  return `Role default (${attendanceModeLabel(roleDefaultAttendanceMode(role))})`;
}

/** NULL in the database means role default. */
export function attendanceModeToStored(
  selected: string | null | undefined,
): AttendanceMode | null {
  const value = selected?.trim();
  return isAttendanceMode(value) ? value : null;
}

/** Exempt staff never get late / early-leave / missing-clock exceptions. */
export function exceptionsApplyToMode(mode: AttendanceMode): boolean {
  return mode !== "exempt";
}

/** Exempt staff are never counted absent for payroll. */
export function payrollAbsenceDaysForMode(
  mode: AttendanceMode,
  absenceDays: number,
): number {
  return isExemptMode(mode) ? 0 : absenceDays;
}

// ---------------------------------------------------------------------------
// Weekday and date helpers
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ISO weekday for a YYYY-MM-DD calendar date: Mon = 1 … Sun = 7. */
export function isoWeekdayForDate(dateIso: string): number | null {
  const day = dateIso.slice(0, 10);
  if (!ISO_DATE.test(day)) {
    return null;
  }
  const [year, month, date] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1));
  if (Number.isNaN(utc.getTime())) {
    return null;
  }
  const js = utc.getUTCDay();
  return js === 0 ? 7 : js;
}

export function weekdayShortLabel(weekday: number): string {
  return ISO_WEEKDAYS.find((entry) => entry.value === weekday)?.short ?? "?";
}

export function formatWeekdays(weekdays: readonly number[]): string {
  return [...new Set(weekdays)]
    .sort((a, b) => a - b)
    .map(weekdayShortLabel)
    .join(", ");
}

export function normalizeWeekdays(weekdays: readonly number[]): number[] {
  return [
    ...new Set(
      weekdays.filter(
        (value) => Number.isInteger(value) && value >= 1 && value <= 7,
      ),
    ),
  ].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/** Active, inside the date range, and the ISO weekday is listed. Full-day. */
export function arrangementCoversDate(
  arrangement: ArrangementWindow,
  dateIso: string,
): boolean {
  if (!arrangement.is_active) {
    return false;
  }
  const day = dateIso.slice(0, 10);
  const weekday = isoWeekdayForDate(day);
  if (weekday == null) {
    return false;
  }
  if (day < arrangement.start_date.slice(0, 10)) {
    return false;
  }
  if (arrangement.end_date && day > arrangement.end_date.slice(0, 10)) {
    return false;
  }
  return arrangement.weekdays.includes(weekday);
}

/** Keep only one tenant's rows. Cross-tenant rows are never mixed in. */
export function arrangementsForTenant<T extends { tenant_id: string }>(
  rows: readonly T[],
  tenantId: string,
): T[] {
  return rows.filter((row) => row.tenant_id === tenantId);
}

/**
 * First active arrangement of this tenant + staff that covers the date.
 * An auto-approve arrangement wins over one that still needs approval.
 */
export function findCoveringArrangement<T extends RemoteWorkArrangement>(
  arrangements: readonly T[],
  input: { tenantId: string; staffId: string; dateIso: string },
): T | null {
  const covering = arrangementsForTenant(arrangements, input.tenantId).filter(
    (row) =>
      row.staff_id === input.staffId &&
      arrangementCoversDate(row, input.dateIso),
  );
  return covering.find((row) => row.auto_approve) ?? covering[0] ?? null;
}

/** True when the staff member has any active arrangement that has not ended. */
export function hasOpenArrangement(
  arrangements: readonly RemoteWorkArrangement[],
  input: { tenantId: string; staffId: string; todayIso: string },
): boolean {
  return arrangementsForTenant(arrangements, input.tenantId).some(
    (row) =>
      row.staff_id === input.staffId &&
      row.is_active &&
      (!row.end_date || row.end_date.slice(0, 10) >= input.todayIso.slice(0, 10)),
  );
}

// ---------------------------------------------------------------------------
// Remote clock decision
// ---------------------------------------------------------------------------

export type RemoteClockDecision =
  | { allowed: false; code: "exempt"; message: string }
  | { allowed: false; code: "not_enabled"; message: string }
  | {
      allowed: true;
      autoApprove: boolean;
      source: "quick_remote" | "arrangement" | "standard";
      note: string | null;
      arrangementId: string | null;
    };

export const REMOTE_NOT_ENABLED_MESSAGE =
  "Remote attendance is not enabled for your employee record.";

export function decideRemoteClock(input: {
  mode: AttendanceMode;
  remoteAttendanceAllowed: boolean;
  /** Active arrangement covering the clock date, if any. */
  arrangement: RemoteWorkArrangement | null;
}): RemoteClockDecision {
  if (input.mode === "exempt") {
    return { allowed: false, code: "exempt", message: EXEMPT_ATTENDANCE_MESSAGE };
  }
  if (input.mode === "quick_remote") {
    return {
      allowed: true,
      autoApprove: true,
      source: "quick_remote",
      note: QUICK_REMOTE_APPROVAL_NOTE,
      arrangementId: null,
    };
  }
  if (input.arrangement?.auto_approve) {
    return {
      allowed: true,
      autoApprove: true,
      source: "arrangement",
      note: ARRANGEMENT_APPROVAL_NOTE,
      arrangementId: input.arrangement.id,
    };
  }
  if (input.arrangement || input.remoteAttendanceAllowed) {
    return {
      allowed: true,
      autoApprove: false,
      source: input.arrangement ? "arrangement" : "standard",
      note: null,
      arrangementId: input.arrangement?.id ?? null,
    };
  }
  return {
    allowed: false,
    code: "not_enabled",
    message: REMOTE_NOT_ENABLED_MESSAGE,
  };
}

// ---------------------------------------------------------------------------
// Overlap and field validation
// ---------------------------------------------------------------------------

function sharedWeekdays(a: readonly number[], b: readonly number[]): number[] {
  const right = new Set(b);
  return normalizeWeekdays(a.filter((value) => right.has(value)));
}

function dateRangesOverlap(
  a: { start_date: string; end_date: string | null },
  b: { start_date: string; end_date: string | null },
): boolean {
  const aStart = a.start_date.slice(0, 10);
  const bStart = b.start_date.slice(0, 10);
  const aEnd = a.end_date?.slice(0, 10) ?? null;
  const bEnd = b.end_date?.slice(0, 10) ?? null;
  const startsBeforeBEnds = bEnd == null || aStart <= bEnd;
  const bStartsBeforeAEnds = aEnd == null || bStart <= aEnd;
  return startsBeforeBEnds && bStartsBeforeAEnds;
}

/** User-facing date range for remote work tables and overlap messages. */
export function formatArrangementDateRange(
  start: string,
  end: string | null | undefined,
): string {
  const startLabel = formatDate(start.slice(0, 10));
  const endTrimmed = end?.trim() ? end.slice(0, 10) : "";
  if (!endTrimmed) {
    return `from ${startLabel}`;
  }
  return `${startLabel} – ${formatDate(endTrimmed)}`;
}

function formatRange(start: string, end: string | null): string {
  return formatArrangementDateRange(start, end);
}

export function overlapMessage(
  existing: Pick<
    RemoteWorkArrangement,
    "weekdays" | "start_date" | "end_date"
  >,
  candidate?: Pick<ArrangementDraft, "weekdays">,
): string {
  const shared = candidate
    ? sharedWeekdays(existing.weekdays, candidate.weekdays)
    : normalizeWeekdays(existing.weekdays);
  return `This staff member already has an active remote work arrangement on ${formatWeekdays(shared)} (${formatRange(existing.start_date, existing.end_date)}) that overlaps this one. Change the days or dates, or deactivate the existing arrangement first.`;
}

export type OverlapResult =
  | { ok: true }
  | { ok: false; message: string; conflict: RemoteWorkArrangement };

/**
 * Refuse when another active arrangement for the same tenant + staff shares a
 * weekday within an overlapping date range. Inactive candidates never conflict.
 */
export function validateArrangementOverlap(
  existing: readonly RemoteWorkArrangement[],
  candidate: ArrangementDraft,
): OverlapResult {
  if (!candidate.is_active) {
    return { ok: true };
  }
  for (const row of arrangementsForTenant(existing, candidate.tenant_id)) {
    if (
      row.staff_id !== candidate.staff_id ||
      !row.is_active ||
      (candidate.id && row.id === candidate.id)
    ) {
      continue;
    }
    if (
      sharedWeekdays(row.weekdays, candidate.weekdays).length > 0 &&
      dateRangesOverlap(row, candidate)
    ) {
      return { ok: false, message: overlapMessage(row, candidate), conflict: row };
    }
  }
  return { ok: true };
}

export type ArrangementFieldIssue = {
  field: "weekdays" | "start_date" | "end_date" | "location_note" | "reason";
  message: string;
};

export function normalizeArrangementReason(
  reason: string | null | undefined,
): string {
  return reason?.trim() || DEFAULT_ARRANGEMENT_REASON;
}

export function arrangementFieldIssues(input: {
  weekdays: readonly number[];
  start_date: string;
  end_date: string | null;
  location_note: string;
  reason?: string | null;
}): ArrangementFieldIssue[] {
  const issues: ArrangementFieldIssue[] = [];
  const weekdays = normalizeWeekdays(input.weekdays);
  if (weekdays.length === 0) {
    issues.push({ field: "weekdays", message: "Choose at least one weekday." });
  }
  const start = input.start_date.trim();
  const end = input.end_date?.trim() ?? "";
  if (!ISO_DATE.test(start)) {
    issues.push({ field: "start_date", message: "Start date is required." });
  }
  if (end && !ISO_DATE.test(end)) {
    issues.push({ field: "end_date", message: "End date is not valid." });
  } else if (end && ISO_DATE.test(start) && end < start) {
    issues.push({
      field: "end_date",
      message: "End date cannot be before the start date.",
    });
  }
  const location = input.location_note.trim();
  if (!location) {
    issues.push({ field: "location_note", message: "Location is required." });
  } else if (location.length > 500) {
    issues.push({
      field: "location_note",
      message: "Location must be 500 characters or fewer.",
    });
  }
  if ((input.reason?.trim().length ?? 0) > 500) {
    issues.push({
      field: "reason",
      message: "Reason must be 500 characters or fewer.",
    });
  }
  return issues;
}
