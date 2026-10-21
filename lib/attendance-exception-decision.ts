import { isReviewedException } from "@/lib/shift-attendance";

export const ATTENDANCE_EXCEPTION_DECISIONS = [
  "full_day",
  "half_day",
  "absent",
] as const;

export type AttendanceExceptionDecision =
  (typeof ATTENDANCE_EXCEPTION_DECISIONS)[number];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function isAttendanceExceptionDecision(
  value: string | null | undefined,
): value is AttendanceExceptionDecision {
  return (ATTENDANCE_EXCEPTION_DECISIONS as readonly string[]).includes(
    value ?? "",
  );
}

export function exceptionDecisionLabel(
  status: string | null | undefined,
): string {
  switch (status) {
    case "full_day":
      return "Full day";
    case "half_day":
      return "Half day";
    case "absent":
      return "Absent";
    case "pending":
      return "Pending";
    default:
      return "None";
  }
}

export function decisionSavedToast(decision: AttendanceExceptionDecision): string {
  return `Decision saved — ${exceptionDecisionLabel(decision)}`;
}

export function payrollLockAttendanceMessage(date: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(date.slice(0, 10));
  const year = match?.[1] ?? "";
  const monthIndex = Number(match?.[2] ?? "1") - 1;
  const monthName = MONTH_NAMES[monthIndex] ?? "that month";
  return `Payroll for ${monthName} ${year} is locked — unlock it first to change attendance.`;
}

export function payrollMonthBounds(date: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})/.exec(date.slice(0, 10));
  const year = Number(match?.[1] ?? "1970");
  const month = Number(match?.[2] ?? "1");
  const start = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, end };
}

/**
 * Status edit on a row that already has an exception.
 * Absent forces the decision to absent. Present or Late while the decision
 * is absent needs a new Full day or Half day choice.
 */
export function decisionRequiredForStatusEdit(
  exceptionStatus: string | null | undefined,
  nextAttendanceStatus: string,
): AttendanceExceptionDecision | "ask_full_or_half" | null {
  const exception = exceptionStatus ?? "none";
  if (exception === "none") {
    return null;
  }
  if (nextAttendanceStatus === "Absent") {
    return exception === "absent" ? null : "absent";
  }
  if (
    (nextAttendanceStatus === "Present" || nextAttendanceStatus === "Late") &&
    exception === "absent"
  ) {
    return "ask_full_or_half";
  }
  return null;
}

export function buildExceptionDecisionUpdate(input: {
  previousExceptionStatus: string | null | undefined;
  previousAttendanceStatus: string | null | undefined;
  previousReviewNote?: string | null;
  lateMinutes?: number | null;
  decision: AttendanceExceptionDecision;
  note?: string | null;
  attendanceStatus?: string | null;
}): {
  exception_status: AttendanceExceptionDecision;
  attendance_status?: string;
  review_note: string | null;
} {
  const note = input.note?.trim() || null;
  const previous = input.previousExceptionStatus ?? "none";
  const previousNote = input.previousReviewNote?.trim() || null;
  const changeLine =
    isReviewedException(previous) && previous !== input.decision
      ? `Changed from ${exceptionDecisionLabel(previous)} to ${exceptionDecisionLabel(input.decision)}.`
      : null;
  const keptPrevious =
    changeLine && previousNote ? `Previous note: ${previousNote}` : null;
  const reviewNote = [changeLine, note, keptPrevious].filter(Boolean).join(" ");

  const update: {
    exception_status: AttendanceExceptionDecision;
    attendance_status?: string;
    review_note: string | null;
  } = {
    exception_status: input.decision,
    review_note: reviewNote || input.previousReviewNote?.trim() || null,
  };

  if (input.decision === "absent") {
    update.attendance_status = "Absent";
    return update;
  }

  const requested = input.attendanceStatus?.trim() ?? "";
  if (requested === "Present" || requested === "Late") {
    update.attendance_status = requested;
    return update;
  }

  if (input.previousAttendanceStatus === "Absent") {
    update.attendance_status = (input.lateMinutes ?? 0) > 0 ? "Late" : "Present";
  }

  return update;
}
