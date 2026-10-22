import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildExceptionDecisionUpdate,
  isAttendanceExceptionDecision,
  payrollLockAttendanceMessage,
  payrollMonthBounds,
  type AttendanceExceptionDecision,
} from "@/lib/attendance-exception-decision";
import { isReviewedException } from "@/lib/shift-attendance";

export type AppliedAttendanceDecision = {
  id: string;
  date: string;
  staff_id: string;
  attendance_status: string;
  exception_status: string;
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

export async function payrollMonthIsLocked(
  admin: SupabaseClient,
  tenantId: string,
  date: string,
): Promise<{ locked: boolean; error: string | null }> {
  const { start, end } = payrollMonthBounds(date);
  const { data, error } = await admin
    .from("payroll_history")
    .select("id")
    .eq("tenant_id", tenantId)
    .gte("payroll_month", start)
    .lt("payroll_month", end)
    .limit(1);

  if (error) {
    return { locked: false, error: error.message };
  }
  return { locked: (data?.length ?? 0) > 0, error: null };
}

export async function applyAttendanceExceptionDecision(
  admin: SupabaseClient,
  input: {
    tenantId: string;
    attendanceRegisterId: string;
    decision: AttendanceExceptionDecision;
    note?: string | null;
    reviewedBy: string;
    attendanceStatus?: string | null;
  },
): Promise<
  | { ok: true; row: AppliedAttendanceDecision }
  | { ok: false; status: number; error: string }
> {
  if (!isAttendanceExceptionDecision(input.decision)) {
    return { ok: false, status: 400, error: "Choose a decision for this row." };
  }

  const { data: existing, error: existingError } = await admin
    .from("attendance_register")
    .select(
      "id, date, staff_id, exception_status, attendance_status, late_minutes, review_note",
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.attendanceRegisterId)
    .maybeSingle();

  if (existingError) {
    return { ok: false, status: 500, error: existingError.message };
  }
  if (!existing) {
    return { ok: false, status: 404, error: "Attendance row was not found." };
  }

  const previousStatus = String(existing.exception_status ?? "none");
  if (previousStatus !== "pending" && !isReviewedException(previousStatus)) {
    return {
      ok: false,
      status: 409,
      error: "This attendance row is not an exception.",
    };
  }

  const lock = await payrollMonthIsLocked(
    admin,
    input.tenantId,
    String(existing.date ?? ""),
  );
  if (lock.error) {
    return { ok: false, status: 500, error: lock.error };
  }
  if (lock.locked) {
    return {
      ok: false,
      status: 409,
      error: payrollLockAttendanceMessage(String(existing.date ?? "")),
    };
  }

  const decisionUpdate = buildExceptionDecisionUpdate({
    previousExceptionStatus: previousStatus,
    previousAttendanceStatus:
      existing.attendance_status == null
        ? null
        : String(existing.attendance_status),
    previousReviewNote:
      existing.review_note == null ? null : String(existing.review_note),
    lateMinutes:
      existing.late_minutes == null ? null : Number(existing.late_minutes),
    decision: input.decision,
    note: input.note,
    attendanceStatus: input.attendanceStatus,
  });

  const reviewedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("attendance_register")
    .update({
      ...decisionUpdate,
      reviewed_by: input.reviewedBy,
      reviewed_at: reviewedAt,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.attendanceRegisterId)
    .select(
      "id, date, staff_id, attendance_status, exception_status, review_note, reviewed_at, reviewed_by",
    )
    .maybeSingle();

  if (updateError) {
    return { ok: false, status: 500, error: updateError.message };
  }
  if (!updated) {
    return { ok: false, status: 404, error: "Attendance row was not found." };
  }

  return {
    ok: true,
    row: {
      id: String(updated.id),
      date: String(updated.date ?? "").slice(0, 10),
      staff_id: String(updated.staff_id ?? ""),
      attendance_status: String(updated.attendance_status ?? ""),
      exception_status: String(updated.exception_status ?? ""),
      review_note:
        updated.review_note == null ? null : String(updated.review_note),
      reviewed_at:
        updated.reviewed_at == null ? reviewedAt : String(updated.reviewed_at),
      reviewed_by:
        updated.reviewed_by == null ? input.reviewedBy : String(updated.reviewed_by),
    },
  };
}
