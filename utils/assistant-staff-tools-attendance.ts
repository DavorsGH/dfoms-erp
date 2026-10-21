import "server-only";

import { exceptionDecisionLabel } from "@/lib/attendance-exception-decision";
import {
  ATTENDANCE_MODE_LABELS,
  ARRANGEMENT_COLUMNS,
  formatWeekdays,
  resolveAttendanceMode,
  roleDefaultAttendanceMode,
  type AttendanceMode,
  type RemoteWorkArrangement,
} from "@/lib/attendance-mode";
import {
  SCHEDULE_DAY_TYPES,
  SCHEDULE_SHIFTS,
  formatScheduleClock,
  type ScheduleDayType,
  type ScheduleShift,
} from "@/lib/shift-attendance";
import { parseAssistantYearMonth } from "@/utils/assistant-period-resolve";
import {
  attendanceExceptionsAccessError,
  employeeAttendanceModeAccessError,
  isAttendanceModeUsingRoleDefault,
  parseAttendanceExceptionsView,
  remoteWorkArrangementsAccessError,
  shiftTimesAccessError,
} from "@/utils/assistant-staff-r55-helpers";
import {
  LIST_LIMIT,
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";
import {
  HR_ASSISTANT_LIST_LIMIT,
  fetchAssistantDirectoryEmployees,
  loadStaffBusinessUnitScope,
  normalizeSearchText,
  parseOptionalStringField,
  parseRequiredStringField,
  resolveEmployeeInScope,
} from "@/utils/assistant-staff-tools-hr-common";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";

export {
  attendanceExceptionsAccessError,
  canAccessShiftTimesAssistant,
  employeeAttendanceModeAccessError,
  isAttendanceModeUsingRoleDefault,
  parseAttendanceExceptionsView,
  remoteWorkArrangementsAccessError,
  shiftTimesAccessError,
  SHIFT_TIMES_ASSISTANT_ROLES,
} from "@/utils/assistant-staff-r55-helpers";

export const ATTENDANCE_EXCEPTIONS_LIST_LIMIT = 50;
export const SHIFT_TIMES_CONTRACT_LIMIT = LIST_LIMIT;

function monthDateBounds(year: number, month: number): {
  start: string;
  endExclusive: string;
} {
  const start = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endExclusive = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, endExclusive };
}

export async function getAttendanceExceptions(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  const accessError = attendanceExceptionsAccessError(sessionResult.session.role);
  if (accessError) {
    return { error: accessError };
  }

  const view = parseAttendanceExceptionsView(toolInput);
  const { year, month } = parseAssistantYearMonth(toolInput);
  const employeeName = parseOptionalStringField(toolInput, "employeeName");
  const staffIdFilter = parseOptionalStringField(toolInput, "staffId");
  const contractName = parseOptionalStringField(toolInput, "contractName");
  const { start, endExclusive } = monthDateBounds(year, month);

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();

    const { data: scopedEmployees, error: employeesError } =
      await applyBusinessUnitScope(
        supabase
          .from("employees")
          .select("staff_id, full_name, contract_project")
          .eq("tenant_id", sessionResult.session.tenantId),
        buScope,
      );

    if (employeesError) {
      return {
        error: STAFF_DATA_UNAVAILABLE_MESSAGE,
        fetchWarning: employeesError.message,
      };
    }

    const nameByStaff = new Map<string, string>();
    const contractByStaff = new Map<string, string>();
    const scopedStaffIds = new Set<string>();
    for (const employee of scopedEmployees ?? []) {
      const staffId = String(employee.staff_id ?? "").trim();
      if (!staffId) continue;
      scopedStaffIds.add(staffId);
      nameByStaff.set(staffId, String(employee.full_name ?? "").trim());
      contractByStaff.set(
        staffId,
        String(employee.contract_project ?? "").trim(),
      );
    }

    let query = supabase
      .from("attendance_register")
      .select(
        "id, date, staff_id, scheduled_shift, scheduled_day_type, scheduled_start, scheduled_end, clock_in, clock_out, late_minutes, early_leave_minutes, exception_status, attendance_status, review_note",
      )
      .eq("tenant_id", sessionResult.session.tenantId)
      .gte("date", start)
      .lt("date", endExclusive);

    if (view === "decided") {
      query = query.in("exception_status", ["full_day", "half_day", "absent"]);
    } else if (view === "all") {
      query = query.in("exception_status", [
        "pending",
        "full_day",
        "half_day",
        "absent",
      ]);
    } else {
      query = query.eq("exception_status", "pending");
    }

    const { data, error } = await query
      .order("date", { ascending: false })
      .limit(500);

    if (error) {
      return {
        error: STAFF_DATA_UNAVAILABLE_MESSAGE,
        fetchWarning: error.message,
      };
    }

    const employeeNeedle = employeeName
      ? normalizeSearchText(employeeName)
      : "";
    const staffIdNeedle = staffIdFilter
      ? normalizeSearchText(staffIdFilter)
      : "";
    const contractNeedle = contractName
      ? normalizeSearchText(contractName)
      : "";

    const exceptions = (data ?? [])
      .map((row) => {
        const staffId = String(row.staff_id ?? "").trim();
        return {
          date: String(row.date ?? ""),
          employeeName: nameByStaff.get(staffId) || staffId,
          staffId,
          contractName: contractByStaff.get(staffId) || null,
          shift: row.scheduled_shift ? String(row.scheduled_shift) : null,
          dayType: row.scheduled_day_type
            ? String(row.scheduled_day_type)
            : null,
          scheduledStart: formatScheduleClock(
            row.scheduled_start as string | null,
          ),
          scheduledEnd: formatScheduleClock(row.scheduled_end as string | null),
          actualClockIn: formatScheduleClock(row.clock_in as string | null),
          actualClockOut: formatScheduleClock(row.clock_out as string | null),
          lateMinutes:
            typeof row.late_minutes === "number" ? row.late_minutes : 0,
          earlyLeaveMinutes:
            typeof row.early_leave_minutes === "number"
              ? row.early_leave_minutes
              : null,
          decision: exceptionDecisionLabel(
            row.exception_status as string | null,
          ),
        };
      })
      .filter((row) => {
        if (!row.staffId || !scopedStaffIds.has(row.staffId)) {
          return false;
        }
        if (
          staffIdNeedle &&
          normalizeSearchText(row.staffId) !== staffIdNeedle
        ) {
          return false;
        }
        if (employeeNeedle) {
          if (
            !normalizeSearchText(row.employeeName).includes(employeeNeedle)
          ) {
            return false;
          }
        }
        if (contractNeedle) {
          const contractHay = normalizeSearchText(row.contractName ?? "");
          const shiftHay = normalizeSearchText(row.shift ?? "");
          if (
            !contractHay.includes(contractNeedle) &&
            !shiftHay.includes(contractNeedle)
          ) {
            return false;
          }
        }
        return true;
      })
      .slice(0, ATTENDANCE_EXCEPTIONS_LIST_LIMIT);

    return {
      periodLabel: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`,
      year,
      month,
      view,
      count: exceptions.length,
      exceptions,
      note: contractName
        ? "contractName matches employee contract/project text or scheduled shift label when available."
        : undefined,
    };
  } catch (error) {
    console.error("[assistant] get_attendance_exceptions threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

function orderShifts(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const order = new Map(
    (SCHEDULE_SHIFTS as readonly ScheduleShift[]).map((shift, index) => [
      shift,
      index,
    ]),
  );
  return [...rows].sort((a, b) => {
    const left = order.get(String(a.shift) as ScheduleShift) ?? 99;
    const right = order.get(String(b.shift) as ScheduleShift) ?? 99;
    return left - right;
  });
}

export async function getShiftTimes(toolInput?: unknown): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  const accessError = shiftTimesAccessError(sessionResult.session.role);
  if (accessError) {
    return { error: accessError };
  }

  const contractName = parseOptionalStringField(toolInput, "contractName");

  try {
    const supabase = await getStaffSupabase();
    const [
      { data: shiftRows, error: shiftError },
      { data: clients, error: clientsError },
      { data: grace },
    ] = await Promise.all([
      supabase
        .from("contract_shift_times")
        .select(
          "client_id, shift, day_type, start_time, end_time, late_grace_minutes, early_leave_grace_minutes",
        )
        .eq("tenant_id", sessionResult.session.tenantId),
      supabase
        .from("customers")
        .select("client_id, client_name")
        .eq("tenant_id", sessionResult.session.tenantId),
      supabase
        .from("attendance_grace_policy")
        .select("late_grace_minutes, early_leave_grace_minutes")
        .eq("tenant_id", sessionResult.session.tenantId)
        .maybeSingle(),
    ]);

    if (shiftError || clientsError) {
      return {
        error: STAFF_DATA_UNAVAILABLE_MESSAGE,
        fetchWarning: shiftError?.message ?? clientsError?.message,
      };
    }

    const clientNameById = new Map<string, string>();
    for (const client of clients ?? []) {
      clientNameById.set(
        String(client.client_id),
        String(client.client_name ?? "").trim() || String(client.client_id),
      );
    }

    const needle = contractName ? normalizeSearchText(contractName) : "";
    const byClient = new Map<
      string,
      {
        contractName: string;
        weekday: Array<Record<string, unknown>>;
        weekendHoliday: Array<Record<string, unknown>>;
      }
    >();

    for (const row of shiftRows ?? []) {
      const clientId = String(row.client_id ?? "");
      const name = clientNameById.get(clientId) ?? clientId;
      if (needle && !normalizeSearchText(name).includes(needle)) {
        continue;
      }
      let bucket = byClient.get(clientId);
      if (!bucket) {
        bucket = { contractName: name, weekday: [], weekendHoliday: [] };
        byClient.set(clientId, bucket);
      }
      const entry = {
        shift: String(row.shift ?? ""),
        start: formatScheduleClock(row.start_time as string | null),
        end: formatScheduleClock(row.end_time as string | null),
        lateGraceMinutes:
          typeof row.late_grace_minutes === "number"
            ? row.late_grace_minutes
            : null,
        earlyLeaveGraceMinutes:
          typeof row.early_leave_grace_minutes === "number"
            ? row.early_leave_grace_minutes
            : null,
      };
      const dayType = String(row.day_type ?? "") as ScheduleDayType;
      if (dayType === "weekend") {
        bucket.weekendHoliday.push(entry);
      } else {
        bucket.weekday.push(entry);
      }
    }

    const allContracts = [...byClient.values()].sort((a, b) =>
      a.contractName.localeCompare(b.contractName),
    );
    const contracts = allContracts
      .slice(0, SHIFT_TIMES_CONTRACT_LIMIT)
      .map((contract) => ({
        contractName: contract.contractName,
        weekday: orderShifts(contract.weekday),
        weekendHoliday: orderShifts(contract.weekendHoliday),
      }));

    if (contractName && contracts.length === 0) {
      return {
        error: `No shift times matched contractName "${contractName}".`,
        availableContractNames: [...clientNameById.values()]
          .filter(Boolean)
          .slice(0, LIST_LIMIT),
      };
    }

    return {
      companyDefaultLateGraceMinutes:
        typeof grace?.late_grace_minutes === "number"
          ? grace.late_grace_minutes
          : 30,
      companyDefaultEarlyLeaveGraceMinutes:
        typeof grace?.early_leave_grace_minutes === "number"
          ? grace.early_leave_grace_minutes
          : 30,
      dayTypes: [...SCHEDULE_DAY_TYPES],
      shifts: [...SCHEDULE_SHIFTS],
      contracts,
      truncated: allContracts.length > contracts.length,
      note: "Blank grace on a shift uses the company default. Weekend & holidays covers Saturdays, Sundays and public holidays.",
    };
  } catch (error) {
    console.error("[assistant] get_shift_times threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getEmployeeAttendanceMode(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  const accessError = employeeAttendanceModeAccessError(
    sessionResult.session.role,
  );
  if (accessError) {
    return { error: accessError };
  }

  const employeeId = parseRequiredStringField(toolInput, "employeeId");
  if (!employeeId) {
    return { error: "employeeId is required." };
  }

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const { employees, fetchError } = await fetchAssistantDirectoryEmployees(
      supabase,
      buScope,
    );
    if (fetchError) {
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE, fetchWarning: fetchError };
    }

    const employee = resolveEmployeeInScope(employees, employeeId);
    if (!employee) {
      return {
        error:
          "No employee matched that identifier in your current business unit scope.",
      };
    }

    const { data: employeeRow, error: empError } = await supabase
      .from("employees")
      .select("employee_id, staff_id, full_name, attendance_mode")
      .eq("tenant_id", sessionResult.session.tenantId)
      .eq("employee_id", employee.employee_id)
      .maybeSingle();

    if (empError) {
      return {
        error: STAFF_DATA_UNAVAILABLE_MESSAGE,
        fetchWarning: empError.message,
      };
    }

    const { data: account } = await supabase
      .from("user_accounts")
      .select("role, is_active")
      .eq("tenant_id", sessionResult.session.tenantId)
      .eq("employee_id", employee.employee_id)
      .order("is_active", { ascending: false })
      .limit(1)
      .maybeSingle();

    const role = (account?.role as string | null) ?? null;
    const stored = (employeeRow?.attendance_mode as string | null) ?? null;
    const roleDefault = roleDefaultAttendanceMode(role);
    const resolved = resolveAttendanceMode(
      { attendance_mode: stored },
      role,
    );
    const isRoleDefault = isAttendanceModeUsingRoleDefault(stored);

    return {
      employeeName: employee.full_name,
      staffId: employee.staff_id,
      resolvedMode: ATTENDANCE_MODE_LABELS[resolved as AttendanceMode],
      resolvedModeCode: resolved,
      isRoleDefault,
      roleDefaultMode: ATTENDANCE_MODE_LABELS[roleDefault],
      linkedRole: role,
      note: isRoleDefault
        ? "No stored attendance_mode override — using the linked user account role default."
        : "Stored attendance_mode override on the employee record.",
    };
  } catch (error) {
    console.error("[assistant] get_employee_attendance_mode threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getRemoteWorkArrangements(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  const accessError = remoteWorkArrangementsAccessError(
    sessionResult.session.role,
  );
  if (accessError) {
    return { error: accessError };
  }

  const staffFilter = parseOptionalStringField(toolInput, "employeeName");

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const { employees, fetchError } = await fetchAssistantDirectoryEmployees(
      supabase,
      buScope,
    );
    if (fetchError) {
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE, fetchWarning: fetchError };
    }

    const scopedStaffIds = new Set(employees.map((row) => row.staff_id));
    const nameByStaff = new Map(
      employees.map((employee) => [employee.staff_id, employee.full_name]),
    );

    const { data, error } = await supabase
      .from("remote_work_arrangements")
      .select(ARRANGEMENT_COLUMNS)
      .eq("tenant_id", sessionResult.session.tenantId)
      .eq("is_active", true)
      .order("start_date", { ascending: false })
      .limit(100);

    if (error) {
      return {
        error: STAFF_DATA_UNAVAILABLE_MESSAGE,
        fetchWarning: error.message,
      };
    }

    const needle = staffFilter ? normalizeSearchText(staffFilter) : "";
    const rows = ((data as RemoteWorkArrangement[] | null) ?? [])
      .filter((row) => scopedStaffIds.has(row.staff_id))
      .map((row) => {
        const employeeName = nameByStaff.get(row.staff_id) || row.staff_id;
        return {
          employeeName,
          staffId: row.staff_id,
          weekdays: formatWeekdays(row.weekdays ?? []),
          startDate: row.start_date,
          endDate: row.end_date,
          location: row.location_note || null,
          autoApprove: Boolean(row.auto_approve),
        };
      })
      .filter((row) => {
        if (!needle) return true;
        return normalizeSearchText(
          `${row.employeeName} ${row.staffId}`,
        ).includes(needle);
      })
      .slice(0, HR_ASSISTANT_LIST_LIMIT);

    return {
      count: rows.length,
      arrangements: rows,
    };
  } catch (error) {
    console.error("[assistant] get_remote_work_arrangements threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}
