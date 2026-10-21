import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attendanceScheduleColumns,
  resolveExpectedSchedule,
  scheduleDayTypeForDate,
  type AttendanceScheduleColumns,
  type ContractProjectRef,
  type ContractSiteRef,
  type GracePolicy,
  type RosterCoverage,
  type ShiftTimeRecord,
} from "@/lib/shift-attendance";

export type ShiftScheduleContext = {
  projects: ContractProjectRef[];
  sites: ContractSiteRef[];
  shiftTimes: ShiftTimeRecord[];
  grace: GracePolicy | null;
  holidayDates: string[];
};

const EMPTY_CONTEXT: ShiftScheduleContext = {
  projects: [],
  sites: [],
  shiftTimes: [],
  grace: null,
  holidayDates: [],
};

type SiteQueryRow = {
  client_id: string | null;
  project_code?: string | null;
  project?:
    | { project_code?: string | null }
    | { project_code?: string | null }[]
    | null;
};

function projectCodeFromSite(row: SiteQueryRow): string | null {
  if (row.project_code?.trim()) {
    return row.project_code.trim();
  }
  const embedded = Array.isArray(row.project) ? row.project[0] : row.project;
  const code = embedded?.project_code?.trim() ?? "";
  return code || null;
}

export async function loadShiftScheduleContext(
  admin: SupabaseClient,
  tenantId: string,
): Promise<ShiftScheduleContext> {
  const [projectsRes, sitesRes, timesRes, graceRes, holidaysRes] = await Promise.all([
    admin
      .from("projects")
      .select("project_code, project_name, service_contract_id, is_archived")
      .eq("tenant_id", tenantId),
    admin
      .from("sites")
      .select("client_id, project:projects!sites_project_id_fkey(project_code)")
      .eq("tenant_id", tenantId),
    admin
      .from("contract_shift_times")
      .select(
        "client_id, shift, day_type, start_time, end_time, late_grace_minutes, early_leave_grace_minutes",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("attendance_grace_policy")
      .select("late_grace_minutes, early_leave_grace_minutes")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin.from("tenant_holidays").select("holiday_date").eq("tenant_id", tenantId),
  ]);

  if (projectsRes.error && sitesRes.error && timesRes.error) {
    return EMPTY_CONTEXT;
  }

  const sites = ((sitesRes.data ?? []) as SiteQueryRow[]).map((row) => ({
    client_id: row.client_id,
    project_code: projectCodeFromSite(row),
  }));

  return {
    projects: (projectsRes.data as ContractProjectRef[] | null) ?? [],
    sites,
    shiftTimes: timesRes.error
      ? []
      : ((timesRes.data as ShiftTimeRecord[] | null) ?? []),
    grace: graceRes.error
      ? null
      : ((graceRes.data as GracePolicy | null) ?? null),
    holidayDates: holidaysRes.error
      ? []
      : ((holidaysRes.data ?? []) as { holiday_date?: string | null }[])
          .map((row) => row.holiday_date?.slice(0, 10) ?? "")
          .filter(Boolean),
  };
}

export async function rosterAssignmentsForEmployee(
  admin: SupabaseClient,
  tenantId: string,
  employeeId: string,
): Promise<RosterCoverage[]> {
  const { data, error } = await admin
    .from("roster_history")
    .select("employee_id, effective_date, end_date, shift")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId);
  if (error) {
    return [];
  }
  return (data as RosterCoverage[] | null) ?? [];
}

export function scheduleColumnsForEmployee(input: {
  context: ShiftScheduleContext;
  employee: {
    employee_id: string;
    position: string | null;
    shift: string | null;
    contract_project: string | null;
  };
  rosterAssignments: RosterCoverage[];
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  existingExceptionStatus?: string | null;
}): AttendanceScheduleColumns | null {
  const dayType = scheduleDayTypeForDate(input.date, input.context.holidayDates);
  const schedule = resolveExpectedSchedule({
    employee: input.employee,
    date: input.date,
    projects: input.context.projects,
    sites: input.context.sites,
    rosterAssignments: input.rosterAssignments,
    shiftTimes: input.context.shiftTimes,
    gracePolicy: input.context.grace,
    holidayDates: input.context.holidayDates,
  });
  return attendanceScheduleColumns({
    date: input.date,
    clockIn: input.clockIn,
    clockOut: input.clockOut,
    schedule,
    dayType,
    existingExceptionStatus: input.existingExceptionStatus,
  });
}
