import {
  formatTimeInZone,
  localDateInZone,
  localDateTimeToUtcIso,
} from "@/lib/adms/timezone-utils";
import { hoursWorkedBetween } from "@/lib/adms/punch-session-utils";

export const ATTENDANCE_TIME_ZONE = "Africa/Accra";

export const OUTAGE_REASONS = [
  "Scanner offline",
  "Power cut",
  "Scanner broken",
] as const;

export type OutageReason = (typeof OUTAGE_REASONS)[number];

export const DIRECTOR_TIER_ROLES = ["director", "super_admin"] as const;

export type AttendanceRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export type ApproverContext = {
  approverAuthUid: string | null;
  approverRole: string | null;
  approverStaffId: string | null;
};

export function todayInAccra(now: Date = new Date()): string {
  return localDateInZone(now.toISOString(), ATTENDANCE_TIME_ZONE);
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  utc.setUTCDate(utc.getUTCDate() + days);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function normalizeClockTime(value: string): string | null {
  const match = value.trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  return `${match[1]}:${match[2]}:${String(second).padStart(2, "0")}`;
}

export function accraDateTimeToIso(
  workDate: string,
  clockTime: string,
): string | null {
  const normalized = normalizeClockTime(clockTime);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return null;
  }
  const converted = localDateTimeToUtcIso(
    `${workDate}T${normalized}`,
    ATTENDANCE_TIME_ZONE,
  );
  return converted?.punchTimeIso ?? null;
}

export function registerTimeFromIso(iso: string): string {
  return formatTimeInZone(iso, ATTENDANCE_TIME_ZONE);
}

export function hoursFromIsoPair(
  clockInIso: string,
  clockOutIso: string | null,
): number | null {
  if (!clockOutIso) {
    return null;
  }
  const hours = hoursWorkedBetween(clockInIso, clockOutIso);
  if (!Number.isFinite(hours) || hours < 0) {
    return null;
  }
  return hours;
}

/** Hours between register time-of-day values on the same work date. */
export function hoursBetweenClockTimes(
  clockIn: string,
  clockOut: string,
): number | null {
  const start = normalizeClockTime(clockIn);
  const end = normalizeClockTime(clockOut);
  if (!start || !end || end <= start) {
    return null;
  }
  const [sh, sm, ss] = start.split(":").map(Number);
  const [eh, em, es] = end.split(":").map(Number);
  const startMinutes = (sh ?? 0) * 60 + (sm ?? 0) + (ss ?? 0) / 60;
  const endMinutes = (eh ?? 0) * 60 + (em ?? 0) + (es ?? 0) / 60;
  const hours = (endMinutes - startMinutes) / 60;
  return Math.round(hours * 100) / 100;
}

export function isWithinWorkingHours(
  start: string,
  end: string,
  now: Date = new Date(),
): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ATTENDANCE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  let hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  if (hour === "24") {
    hour = "00";
  }
  const current = `${hour}:${minute}`;
  const startHm = start.slice(0, 5);
  const endHm = end.slice(0, 5);
  if (startHm === endHm) {
    return true;
  }
  if (startHm < endHm) {
    return current >= startHm && current < endHm;
  }
  return current >= startHm || current < endHm;
}

export function hasRecentDeviceContact(
  lastSeenAt: string | null | undefined,
  offlineAlertMinutes: number,
  nowMs: number = Date.now(),
): boolean {
  if (!lastSeenAt) {
    return false;
  }
  const seen = Date.parse(lastSeenAt);
  if (!Number.isFinite(seen)) {
    return false;
  }
  return nowMs - seen <= offlineAlertMinutes * 60 * 1000;
}

export function isDirectorTierRole(role: string | null | undefined): boolean {
  return role === "director" || role === "super_admin";
}

/**
 * Directors and super admins may decide any request in the tenant, including
 * their own. The current leave approver may decide other people's requests.
 * Nobody else may decide, and nobody may decide their own request unless they
 * are a director or super admin.
 */
export function decideAttendanceRequest(input: {
  actorAuthUid: string;
  actorRole: string;
  actorStaffId: string | null;
  requestStaffId: string;
  approver: ApproverContext;
}): { allowed: boolean; selfApproved: boolean } {
  const isSelf =
    input.actorStaffId != null && input.actorStaffId === input.requestStaffId;
  if (isDirectorTierRole(input.actorRole)) {
    return { allowed: true, selfApproved: isSelf };
  }
  const isLeaveApprover =
    input.approver.approverAuthUid != null &&
    input.actorAuthUid === input.approver.approverAuthUid;
  if (isLeaveApprover && !isSelf) {
    return { allowed: true, selfApproved: false };
  }
  return { allowed: false, selfApproved: false };
}

export type RemoteFieldIssue = {
  field: "location_note" | "reason" | "work_date" | "clock_in" | "clock_out";
  message: string;
};

export function remoteNoteIssues(
  locationNote: string,
  reason: string,
): RemoteFieldIssue[] {
  const issues: RemoteFieldIssue[] = [];
  const location = locationNote.trim();
  const why = reason.trim();
  if (!location) {
    issues.push({ field: "location_note", message: "Location note is required." });
  } else if (location.length > 500) {
    issues.push({
      field: "location_note",
      message: "Location note must be 500 characters or fewer.",
    });
  }
  if (why.length > 500) {
    issues.push({
      field: "reason",
      message: "Reason must be 500 characters or fewer.",
    });
  }
  return issues;
}

export const REMOTE_LOCATION_OPTIONS = [
  "Working from home",
  "Head office",
  "Client site / contract site",
  "Client or supplier meeting",
  "Field visit / inspection",
  "Travelling",
] as const;

export const REMOTE_LOCATION_OTHER = "Other…";

const REMOTE_LOCATION_PRESETS = new Set<string>(REMOTE_LOCATION_OPTIONS);

export function recentCustomLocations(
  notes: Array<string | null | undefined>,
  limit = 3,
): string[] {
  const seen = new Set<string>();
  const recent: string[] = [];
  for (const note of notes) {
    const value = note?.trim() ?? "";
    const key = value.toLowerCase();
    if (!value || REMOTE_LOCATION_PRESETS.has(value) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    recent.push(value);
    if (recent.length >= limit) {
      break;
    }
  }
  return recent;
}

export function preselectRemoteLocation(latest: string | null | undefined): {
  choice: string;
  other: string;
} {
  const value = latest?.trim() ?? "";
  if (!value) {
    return { choice: "", other: "" };
  }
  if (REMOTE_LOCATION_PRESETS.has(value)) {
    return { choice: value, other: "" };
  }
  return { choice: value, other: "" };
}

/** Pending clock-in stays pending. An approved day is written immediately when remote attendance is allowed. */
export function remoteClockOutPlan(input: {
  status: "pending" | "approved";
  remoteAttendanceAllowed: boolean;
}): "stamp_pending" | "auto_apply" | "reopen_pending" {
  if (input.status === "pending") {
    return "stamp_pending";
  }
  return input.remoteAttendanceAllowed ? "auto_apply" : "reopen_pending";
}

export function pastDayFieldIssues(input: {
  workDate: string;
  clockIn: string;
  clockOut: string;
  now?: Date;
}): RemoteFieldIssue[] {
  const issues: RemoteFieldIssue[] = [];
  const workDate = input.workDate.trim();
  if (!workDate) {
    issues.push({ field: "work_date", message: "Date is required." });
  } else {
    const dateError = validatePastWorkDate(workDate, input.now);
    if (dateError) {
      issues.push({ field: "work_date", message: dateError });
    }
  }
  const clockIn = input.clockIn.trim();
  const clockOut = input.clockOut.trim();
  if (!clockIn) {
    issues.push({ field: "clock_in", message: "Clock in is required." });
  }
  if (!clockOut) {
    issues.push({ field: "clock_out", message: "Clock out is required." });
  } else if (clockIn && clockOut <= clockIn) {
    issues.push({
      field: "clock_out",
      message: "Clock-out must be after clock-in.",
    });
  }
  return issues;
}

export function validatePastWorkDate(
  workDate: string,
  now: Date = new Date(),
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return "Choose a valid date.";
  }
  const today = todayInAccra(now);
  if (workDate > today) {
    return "The date cannot be in the future.";
  }
  const oldest = addCalendarDays(today, -31);
  if (workDate < oldest) {
    return "Past attendance can only be added for the last 31 days.";
  }
  return null;
}

export function validateClockPair(input: {
  workDate: string;
  clockIn: string;
  clockOut: string | null;
  now?: Date;
}): { clockInIso: string; clockOutIso: string | null } | { error: string } {
  const now = input.now ?? new Date();
  const clockInIso = accraDateTimeToIso(input.workDate, input.clockIn);
  if (!clockInIso) {
    return { error: "Clock-in time is not valid." };
  }
  let clockOutIso: string | null = null;
  if (input.clockOut) {
    clockOutIso = accraDateTimeToIso(input.workDate, input.clockOut);
    if (!clockOutIso) {
      return { error: "Clock-out time is not valid." };
    }
    if (Date.parse(clockOutIso) <= Date.parse(clockInIso)) {
      return { error: "Clock-out must be after clock-in." };
    }
  }
  const latest = clockOutIso ?? clockInIso;
  if (Date.parse(latest) > now.getTime() + 60_000) {
    return { error: "Clock times cannot be in the future." };
  }
  return { clockInIso, clockOutIso };
}

export type GeoInput = {
  latitude: number;
  longitude: number;
  location_accuracy_m: number;
};

export function parseOptionalGeo(body: {
  latitude?: unknown;
  longitude?: unknown;
  location_accuracy_m?: unknown;
}): GeoInput | null | { error: string } {
  const { latitude, longitude, location_accuracy_m: accuracy } = body;
  const empty = latitude == null && longitude == null && accuracy == null;
  if (empty) {
    return null;
  }
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return { error: "Location coordinates are not valid." };
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { error: "Location coordinates are not valid." };
  }
  const accuracyM = typeof accuracy === "number" ? accuracy : null;
  if (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM < 0) {
    return { error: "Location accuracy is not valid." };
  }
  return {
    latitude,
    longitude,
    location_accuracy_m: Math.round(accuracyM * 100) / 100,
  };
}
