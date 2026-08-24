import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttendanceQueuePayload } from "@/lib/offline-write-queue/types";

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("duplicate key") ||
    message.includes("unique constraint") ||
    message.includes("attendance_register_tenant_staff_date_key")
  );
}

/**
 * Replay an offline attendance create.
 * Idempotency:
 * - Row `id` = queue UUID → PK conflict on retry is success.
 * - UNIQUE (tenant_id, staff_id, date) → DO NOTHING semantics (first write wins).
 */
export async function syncAttendanceQueueItem(
  supabase: SupabaseClient,
  input: {
    clientOpId: string;
    tenantId: string;
    payload: AttendanceQueuePayload;
  },
): Promise<{ ok: true; duplicateNaturalKey: boolean } | { ok: false; error: string }> {
  const row = {
    id: input.clientOpId,
    tenant_id: input.tenantId,
    date: input.payload.date,
    staff_id: input.payload.staff_id,
    employment_type: input.payload.employment_type,
    project_assignment: input.payload.project_assignment,
    clock_in: input.payload.clock_in,
    clock_out: input.payload.clock_out,
    hours_worked: input.payload.hours_worked,
    overtime_hours: input.payload.overtime_hours,
    attendance_status: input.payload.attendance_status,
  };

  const existingById = await supabase
    .from("attendance_register")
    .select("id")
    .eq("id", input.clientOpId)
    .maybeSingle();

  if (existingById.data?.id) {
    return { ok: true, duplicateNaturalKey: false };
  }

  const { error } = await supabase.from("attendance_register").insert(row);

  if (!error) {
    return { ok: true, duplicateNaturalKey: false };
  }

  if (isUniqueViolation(error)) {
    // Same queue id already inserted, or another row owns this staff-day.
    // First-write-wins: treat as successful sync (no second row).
    return { ok: true, duplicateNaturalKey: true };
  }

  return { ok: false, error: error.message };
}
