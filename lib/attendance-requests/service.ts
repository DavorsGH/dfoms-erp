import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { insertEmployeeInAppNotifications } from "@/utils/employee-in-app-notifications";
import { isPostgresUniqueViolation } from "@/utils/postgres-fk-violation";
import {
  hoursFromIsoPair,
  isDirectorTierRole,
  registerTimeFromIso,
  type ApproverContext,
} from "@/lib/attendance-requests/rules";
import type { SessionActor } from "@/lib/attendance-requests/session";
import { loadAttendanceModeForStaff } from "@/lib/attendance-mode-service";
import {
  loadShiftScheduleContext,
  rosterAssignmentsForEmployee,
  scheduleColumnsForEmployee,
} from "@/lib/shift-attendance-context";
import { formatDate } from "@/app/dashboard/finance/income-register-utils";
import { applyStaffIdScope } from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";

export type AttendanceRequestRow = {
  id: string;
  tenant_id: string;
  request_type: "remote" | "outage";
  staff_id: string;
  work_date: string;
  clock_in: string;
  clock_out: string | null;
  location_note: string | null;
  reason: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy_m: number | null;
  device_id: string | null;
  site_code: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  submitted_by: string;
  submitted_by_name: string | null;
  submitted_at: string;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  self_approved: boolean;
  attendance_register_id: string | null;
  employee_name?: string | null;
};

const REQUEST_COLUMNS =
  "id, tenant_id, request_type, staff_id, work_date, clock_in, clock_out, location_note, reason, latitude, longitude, location_accuracy_m, device_id, site_code, status, submitted_by, submitted_by_name, submitted_at, decided_by, decided_by_name, decided_at, decision_note, self_approved, attendance_register_id";

export async function loadApproverContext(
  admin: SupabaseClient,
  tenantId: string,
): Promise<ApproverContext> {
  const { data: config } = await admin
    .from("leave_approver_config")
    .select("approver_user_account_id")
    .eq("tenant_id", tenantId)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const approverAuthUid = config?.approver_user_account_id ?? null;
  if (!approverAuthUid) {
    return { approverAuthUid: null, approverRole: null, approverStaffId: null };
  }

  const { data: account } = await admin
    .from("user_accounts")
    .select("role, employee_id")
    .eq("tenant_id", tenantId)
    .eq("auth_uid", approverAuthUid)
    .maybeSingle();

  let approverStaffId: string | null = null;
  if (account?.employee_id) {
    const { data: employee } = await admin
      .from("employees")
      .select("staff_id")
      .eq("tenant_id", tenantId)
      .eq("employee_id", account.employee_id)
      .maybeSingle();
    approverStaffId = employee?.staff_id ?? null;
  }

  return {
    approverAuthUid,
    approverRole: account?.role ?? null,
    approverStaffId,
  };
}

async function authUidsForRoles(
  admin: SupabaseClient,
  tenantId: string,
  roles: string[],
): Promise<string[]> {
  const { data } = await admin
    .from("user_accounts")
    .select("auth_uid, is_active")
    .eq("tenant_id", tenantId)
    .in("role", roles);

  return (data ?? [])
    .filter((row) => row.is_active !== false && row.auth_uid)
    .map((row) => row.auth_uid as string);
}

export async function notifyAttendanceApprovers(input: {
  admin: SupabaseClient;
  tenantId: string;
  approver: ApproverContext;
  staffIds: string[];
  title: string;
  body: string;
}): Promise<void> {
  const recipients = new Set<string>();
  const directors = await authUidsForRoles(input.admin, input.tenantId, [
    "director",
    "super_admin",
  ]);
  for (const uid of directors) {
    recipients.add(uid);
  }

  const approverUid = input.approver.approverAuthUid;
  if (approverUid) {
    const canDecideSome = input.staffIds.some((staffId) => {
      const isSelf =
        input.approver.approverStaffId != null &&
        input.approver.approverStaffId === staffId;
      return !isSelf || isDirectorTierRole(input.approver.approverRole);
    });
    if (canDecideSome || input.staffIds.length === 0) {
      recipients.add(approverUid);
    }
  }

  if (recipients.size === 0) {
    return;
  }

  await insertEmployeeInAppNotifications({
    context: "attendance-request-submit",
    rows: [...recipients].map((recipient_user_id) => ({
      tenant_id: input.tenantId,
      recipient_user_id,
      title: input.title,
      body: input.body,
      action_url: "/dashboard/attendance-approvals",
    })),
  });
}

export async function notifyEmployeeOfDecision(input: {
  admin: SupabaseClient;
  tenantId: string;
  staffId: string;
  title: string;
  body: string;
}): Promise<void> {
  const { data: employee } = await input.admin
    .from("employees")
    .select("employee_id")
    .eq("tenant_id", input.tenantId)
    .eq("staff_id", input.staffId)
    .maybeSingle();

  if (!employee?.employee_id) {
    return;
  }

  const { data: accounts } = await input.admin
    .from("user_accounts")
    .select("auth_uid, is_active")
    .eq("tenant_id", input.tenantId)
    .eq("employee_id", employee.employee_id)
    .limit(1);

  const recipient = accounts?.find((row) => row.is_active !== false)?.auth_uid;
  if (!recipient) {
    return;
  }

  await insertEmployeeInAppNotifications({
    context: "attendance-request-decision",
    rows: [
      {
        tenant_id: input.tenantId,
        recipient_user_id: recipient,
        title: input.title,
        body: input.body,
        action_url: "/dashboard/self-service/attendance",
      },
    ],
  });
}

export async function insertPendingRequest(
  admin: SupabaseClient,
  row: {
    tenant_id: string;
    request_type: "remote" | "outage";
    staff_id: string;
    work_date: string;
    clock_in: string;
    clock_out: string | null;
    location_note: string | null;
    reason: string | null;
    latitude: number | null;
    longitude: number | null;
    location_accuracy_m: number | null;
    device_id: string | null;
    site_code: string | null;
    contract_project?: string | null;
    submitted_by: string;
    submitted_by_name: string;
  },
): Promise<{ id: string } | { error: string; duplicate?: boolean }> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("attendance_requests")
    .insert({
      ...row,
      status: "pending",
      submitted_at: now,
      self_approved: false,
    })
    .select("id")
    .single();

  if (error) {
    if (isPostgresUniqueViolation(error)) {
      return {
        error: "A pending or approved request already exists for this day.",
        duplicate: true,
      };
    }
    return { error: error.message };
  }

  return { id: data.id as string };
}

export async function loadEmployeeForAttendance(
  admin: SupabaseClient,
  tenantId: string,
  staffId: string,
): Promise<{
  staff_id: string;
  full_name: string;
  employment_type: string | null;
  contract_project: string | null;
  assigned_site_id: string | null;
  employment_status: string | null;
  employee_id: string | null;
  position: string | null;
  shift: string | null;
} | null> {
  const { data } = await admin
    .from("employees")
    .select(
      "staff_id, full_name, employment_type, contract_project, assigned_site_id, employment_status, employee_id, position, shift",
    )
    .eq("tenant_id", tenantId)
    .eq("staff_id", staffId)
    .maybeSingle();
  return data ?? null;
}

/** Exempt staff never get late / early-leave / pending exceptions from a remote day. */
async function isStaffExemptFromExceptions(
  admin: SupabaseClient,
  tenantId: string,
  staffId: string,
): Promise<boolean> {
  try {
    return (
      (await loadAttendanceModeForStaff(admin, tenantId, staffId)) === "exempt"
    );
  } catch {
    return false;
  }
}

/**
 * Record a remote request that needs no approver: insert it, then approve it
 * immediately so the register row is written. If the day cannot be recorded
 * (for example a device row already exists) the request is cancelled so it does
 * not sit in the approver queue.
 */
export async function submitAutoApprovedRemoteRequest(input: {
  admin: SupabaseClient;
  actor: SessionActor;
  row: Parameters<typeof insertPendingRequest>[1];
  approvalNote: string;
}): Promise<
  | { ok: true; id: string }
  | { ok: false; status: number; error: string; duplicate?: boolean }
> {
  const { admin, actor, row, approvalNote } = input;
  const inserted = await insertPendingRequest(admin, row);
  if ("error" in inserted) {
    return {
      ok: false,
      status: inserted.duplicate ? 409 : 500,
      error: inserted.error,
      duplicate: inserted.duplicate,
    };
  }

  const approved = await approveAttendanceRequest({
    admin,
    actor: { ...actor, fullName: "Auto-approved" },
    request: {
      id: inserted.id,
      tenant_id: row.tenant_id,
      request_type: row.request_type,
      staff_id: row.staff_id,
      work_date: row.work_date,
      clock_in: row.clock_in,
      clock_out: row.clock_out,
      location_note: row.location_note,
      reason: row.reason,
      latitude: row.latitude,
      longitude: row.longitude,
      location_accuracy_m: row.location_accuracy_m,
      device_id: row.device_id,
      site_code: row.site_code,
      status: "pending",
      submitted_by: row.submitted_by,
      submitted_by_name: row.submitted_by_name,
      submitted_at: new Date().toISOString(),
      decided_by: null,
      decided_by_name: null,
      decided_at: null,
      decision_note: null,
      self_approved: false,
      attendance_register_id: null,
    },
    selfApproved: false,
    decisionNote: approvalNote,
    notify: false,
  });

  if (!approved.ok) {
    await admin
      .from("attendance_requests")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("tenant_id", actor.tenantId)
      .eq("id", inserted.id)
      .eq("status", "pending");
    return { ok: false, status: approved.status, error: approved.error };
  }
  return { ok: true, id: inserted.id };
}

async function scheduleColumnsForRequest(
  admin: SupabaseClient,
  tenantId: string,
  request: Pick<
    AttendanceRequestRow,
    "request_type" | "staff_id" | "work_date" | "clock_in" | "clock_out"
  >,
  existingExceptionStatus: string | null,
): Promise<Record<string, unknown>> {
  if (request.request_type !== "remote") {
    return {};
  }
  const employee = await loadEmployeeForAttendance(admin, tenantId, request.staff_id);
  if (!employee) {
    return {};
  }
  const shiftContext = await loadShiftScheduleContext(admin, tenantId);
  const rosterAssignments =
    employee.shift === "Rotating" && employee.employee_id
      ? await rosterAssignmentsForEmployee(admin, tenantId, employee.employee_id)
      : [];
  const columns = scheduleColumnsForEmployee({
    context: shiftContext,
    employee: {
      employee_id: employee.employee_id ?? "",
      position: employee.position,
      shift: employee.shift,
      contract_project: employee.contract_project,
    },
    rosterAssignments,
    date: request.work_date,
    clockIn: registerTimeFromIso(request.clock_in),
    clockOut: request.clock_out ? registerTimeFromIso(request.clock_out) : null,
    existingExceptionStatus,
    exempt: await isStaffExemptFromExceptions(admin, tenantId, request.staff_id),
  });
  return columns ?? {};
}

/** Write clock-out and hours onto the attendance row created when the clock-in was approved. */
export async function applyRemoteClockOutToRegister(input: {
  admin: SupabaseClient;
  tenantId: string;
  request: AttendanceRequestRow;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { admin, tenantId, request } = input;
  if (!request.clock_out) {
    return { ok: false, error: "Clock-out time is missing." };
  }

  let registerId = request.attendance_register_id;
  let exceptionStatus: string | null = null;
  if (registerId) {
    const { data: linked, error } = await admin
      .from("attendance_register")
      .select("id, exception_status")
      .eq("tenant_id", tenantId)
      .eq("id", registerId)
      .maybeSingle();
    if (error) {
      return { ok: false, error: error.message };
    }
    if (!linked) {
      registerId = null;
    } else {
      exceptionStatus = linked.exception_status ?? null;
    }
  }

  if (!registerId) {
    const { data: existing, error } = await admin
      .from("attendance_register")
      .select("id, exception_status, source")
      .eq("tenant_id", tenantId)
      .eq("staff_id", request.staff_id)
      .eq("date", request.work_date)
      .maybeSingle();
    if (error) {
      return { ok: false, error: error.message };
    }
    if (!existing || (existing.source && existing.source !== "remote")) {
      return {
        ok: false,
        error: "No remote attendance row was found for this clock-out.",
      };
    }
    registerId = existing.id as string;
    exceptionStatus = existing.exception_status ?? null;
  }

  const scheduleColumns = await scheduleColumnsForRequest(
    admin,
    tenantId,
    request,
    exceptionStatus,
  );
  const { error: updateError } = await admin
    .from("attendance_register")
    .update({
      clock_out: registerTimeFromIso(request.clock_out),
      hours_worked: hoursFromIsoPair(request.clock_in, request.clock_out),
      ...scheduleColumns,
    })
    .eq("tenant_id", tenantId)
    .eq("id", registerId);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }
  return { ok: true };
}

export async function approveAttendanceRequest(input: {
  admin: SupabaseClient;
  actor: SessionActor;
  request: AttendanceRequestRow;
  selfApproved: boolean;
  decisionNote: string | null;
  /** Default true. Auto-approved remote days skip the "request approved" notice. */
  notify?: boolean;
}): Promise<{ ok: true } | { ok: false; status: number; error: string; code?: string; source?: string }> {
  const { admin, actor, request } = input;
  const notify = input.notify !== false;
  const { data: existing, error: existingError } = await admin
    .from("attendance_register")
    .select("id, source")
    .eq("tenant_id", actor.tenantId)
    .eq("staff_id", request.staff_id)
    .eq("date", request.work_date)
    .maybeSingle();

  if (existingError) {
    return { ok: false, status: 500, error: existingError.message };
  }

  if (existing && request.attendance_register_id === existing.id && request.clock_out) {
    const applied = await applyRemoteClockOutToRegister({
      admin,
      tenantId: actor.tenantId,
      request,
    });
    if (!applied.ok) {
      return { ok: false, status: 500, error: applied.error };
    }
    const decidedAt = new Date().toISOString();
    const { error: updateError } = await admin
      .from("attendance_requests")
      .update({
        status: "approved",
        attendance_register_id: existing.id,
        decided_by: actor.authUid,
        decided_by_name: actor.fullName,
        decided_at: decidedAt,
        decision_note: input.decisionNote,
        self_approved: input.selfApproved,
        updated_at: decidedAt,
      })
      .eq("tenant_id", actor.tenantId)
      .eq("id", request.id)
      .eq("status", "pending");
    if (updateError) {
      return { ok: false, status: 500, error: updateError.message };
    }
    if (notify) {
      await notifyEmployeeOfDecision({
        admin,
        tenantId: actor.tenantId,
        staffId: request.staff_id,
        title: "Attendance request approved",
        body: `Your ${request.request_type} attendance for ${formatDate(request.work_date)} was approved.`,
      });
    }
    return { ok: true };
  }

  if (existing) {
    const source = existing.source ?? "unknown";
    return {
      ok: false,
      status: 409,
      code: "already_recorded",
      source,
      error: `Attendance already recorded for this day (source: ${source})`,
    };
  }

  const employee = await loadEmployeeForAttendance(
    admin,
    actor.tenantId,
    request.staff_id,
  );

  const clockIn = registerTimeFromIso(request.clock_in);
  const clockOut = request.clock_out
    ? registerTimeFromIso(request.clock_out)
    : null;
  let scheduleColumns: Record<string, unknown> = {};
  if (request.request_type === "remote" && employee) {
    const shiftContext = await loadShiftScheduleContext(admin, actor.tenantId);
    const rosterAssignments =
      employee.shift === "Rotating" && employee.employee_id
        ? await rosterAssignmentsForEmployee(
            admin,
            actor.tenantId,
            employee.employee_id,
          )
        : [];
    const columns = scheduleColumnsForEmployee({
      context: shiftContext,
      employee: {
        employee_id: employee.employee_id ?? "",
        position: employee.position,
        shift: employee.shift,
        contract_project: employee.contract_project,
      },
      rosterAssignments,
      date: request.work_date,
      clockIn,
      clockOut,
      exempt: await isStaffExemptFromExceptions(
        admin,
        actor.tenantId,
        request.staff_id,
      ),
    });
    if (columns) {
      scheduleColumns = columns;
    }
  }

  const payload = {
    tenant_id: actor.tenantId,
    date: request.work_date,
    staff_id: request.staff_id,
    employment_type: employee?.employment_type ?? null,
    project_assignment: employee?.contract_project ?? null,
    clock_in: clockIn,
    clock_out: clockOut,
    hours_worked: hoursFromIsoPair(request.clock_in, request.clock_out),
    overtime_hours: null,
    attendance_status: "Present",
    source: request.request_type,
    site_code: request.site_code ?? employee?.assigned_site_id ?? null,
    device_id: request.device_id,
    ...scheduleColumns,
  };

  const { data: inserted, error: insertError } = await admin
    .from("attendance_register")
    .insert(payload)
    .select("id, source")
    .single();

  if (insertError || !inserted?.id) {
    if (insertError && isPostgresUniqueViolation(insertError)) {
      const { data: raced } = await admin
        .from("attendance_register")
        .select("source")
        .eq("tenant_id", actor.tenantId)
        .eq("staff_id", request.staff_id)
        .eq("date", request.work_date)
        .maybeSingle();
      const source = raced?.source ?? "unknown";
      return {
        ok: false,
        status: 409,
        code: "already_recorded",
        source,
        error: `Attendance already recorded for this day (source: ${source})`,
      };
    }
    return {
      ok: false,
      status: 500,
      error: insertError?.message ?? "Could not record attendance.",
    };
  }

  const decidedAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("attendance_requests")
    .update({
      status: "approved",
      attendance_register_id: inserted.id,
      decided_by: actor.authUid,
      decided_by_name: actor.fullName,
      decided_at: decidedAt,
      decision_note: input.decisionNote,
      self_approved: input.selfApproved,
      updated_at: decidedAt,
    })
    .eq("tenant_id", actor.tenantId)
    .eq("id", request.id)
    .eq("status", "pending");

  if (updateError) {
    return { ok: false, status: 500, error: updateError.message };
  }

  if (notify) {
    await notifyEmployeeOfDecision({
      admin,
      tenantId: actor.tenantId,
      staffId: request.staff_id,
      title: "Attendance request approved",
      body: `Your ${request.request_type} attendance for ${formatDate(request.work_date)} was approved.`,
    });
  }

  return { ok: true };
}

export async function listOwnRequests(
  admin: SupabaseClient,
  tenantId: string,
  staffId: string,
): Promise<AttendanceRequestRow[]> {
  const { data, error } = await admin
    .from("attendance_requests")
    .select(REQUEST_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("staff_id", staffId)
    .order("work_date", { ascending: false })
    .order("submitted_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as AttendanceRequestRow[];
}

export async function listPendingRequests(
  admin: SupabaseClient,
  tenantId: string,
  staffIds: string[] | null = null,
): Promise<AttendanceRequestRow[]> {
  const { data, error } = await applyStaffIdScope(
    admin
      .from("attendance_requests")
      .select(REQUEST_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("status", "pending"),
    staffIds,
  ).order("submitted_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as AttendanceRequestRow[];
}

export async function attachEmployeeNames(
  admin: SupabaseClient,
  tenantId: string,
  rows: AttendanceRequestRow[],
): Promise<AttendanceRequestRow[]> {
  const staffIds = [...new Set(rows.map((row) => row.staff_id))];
  if (staffIds.length === 0) {
    return rows;
  }
  const { data } = await admin
    .from("employees")
    .select("staff_id, full_name")
    .eq("tenant_id", tenantId)
    .in("staff_id", staffIds);
  const names = new Map(
    (data ?? []).map((row) => [row.staff_id as string, row.full_name as string]),
  );
  return rows.map((row) => ({
    ...row,
    employee_name: names.get(row.staff_id) ?? row.staff_id,
  }));
}

export { REQUEST_COLUMNS };
