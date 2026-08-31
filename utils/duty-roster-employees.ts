import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeDutyRosterEmployee,
  type DutyRosterEmployee,
  type DutyRosterProject,
} from "@/app/dashboard/operations/duty-roster-utils";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";

type DutyRosterEmployeeRow = {
  employee_id: string;
  staff_id: string;
  full_name: string;
  position: string | null;
  shift: string | null;
  contract_project: string | null;
  employment_status: string | null;
};

function scopedRpcParams(buScope: BusinessUnitReadScope): {
  p_business_unit_id: string | null;
  p_view_all: boolean;
} {
  if (buScope.mode === "all") {
    return { p_business_unit_id: null, p_view_all: true };
  }
  if (buScope.mode === "unit") {
    return { p_business_unit_id: buScope.id, p_view_all: false };
  }
  return { p_business_unit_id: null, p_view_all: false };
}

export async function fetchDutyRosterEmployeeDisplay(
  supabase: SupabaseClient,
): Promise<{ employees: DutyRosterEmployee[]; error: string | null }> {
  const { data, error } = await supabase.rpc("get_duty_roster_employee_display");

  if (error) {
    return { employees: [], error: error.message };
  }

  const rows = (data as DutyRosterEmployeeRow[] | null) ?? [];
  return {
    employees: rows.map((row) => normalizeDutyRosterEmployee(row)),
    error: null,
  };
}

export async function fetchDutyRosterEmployeeDisplayScoped(
  supabase: SupabaseClient,
  buScope: BusinessUnitReadScope,
): Promise<{ employees: DutyRosterEmployee[]; error: string | null }> {
  const { data, error } = await supabase.rpc(
    "get_duty_roster_employee_display_scoped",
    scopedRpcParams(buScope),
  );

  if (error) {
    return { employees: [], error: error.message };
  }

  const rows = (data as DutyRosterEmployeeRow[] | null) ?? [];
  return {
    employees: rows.map((row) => normalizeDutyRosterEmployee(row)),
    error: null,
  };
}

export function attachDutyRosterProjectRefs(
  employees: DutyRosterEmployee[],
  projects: DutyRosterProject[],
): DutyRosterEmployee[] {
  return employees.map((employee) => {
    if (!employee.contract_project) {
      return employee;
    }

    const project = projects.find(
      (entry) => entry.project_code === employee.contract_project,
    );

    if (!project) {
      return employee;
    }

    return {
      ...employee,
      project_ref: {
        project_code: project.project_code,
        project_name: project.project_name,
      },
    };
  });
}

export type RosterHistoryEmployee = {
  employee_id: string;
  staff_id: string;
  full_name: string;
};

export async function fetchRosterHistoryEmployeeDisplay(
  supabase: SupabaseClient,
): Promise<{ employees: RosterHistoryEmployee[]; error: string | null }> {
  const { data, error } = await supabase.rpc("get_duty_roster_employee_display");

  if (error) {
    return { employees: [], error: error.message };
  }

  const rows = (data as DutyRosterEmployeeRow[] | null) ?? [];
  return {
    employees: rows.map((row) => ({
      employee_id: row.employee_id,
      staff_id: row.staff_id,
      full_name: row.full_name,
    })),
    error: null,
  };
}

export async function fetchRosterHistoryEmployeeDisplayScoped(
  supabase: SupabaseClient,
  buScope: BusinessUnitReadScope,
): Promise<{ employees: RosterHistoryEmployee[]; error: string | null }> {
  const { data, error } = await supabase.rpc(
    "get_duty_roster_employee_display_scoped",
    scopedRpcParams(buScope),
  );

  if (error) {
    return { employees: [], error: error.message };
  }

  const rows = (data as DutyRosterEmployeeRow[] | null) ?? [];
  return {
    employees: rows.map((row) => ({
      employee_id: row.employee_id,
      staff_id: row.staff_id,
      full_name: row.full_name,
    })),
    error: null,
  };
}
