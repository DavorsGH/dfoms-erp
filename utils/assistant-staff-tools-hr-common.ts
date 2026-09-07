import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/app/dashboard/user-account-types";
import type { EmployeeRecord } from "@/app/dashboard/employees/employee-record-utils";
import { getDepartmentName } from "@/app/dashboard/employees/lookup-utils";
import { getCurrentCalendarMonth } from "@/app/dashboard/dashboard-utils";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  parseFinancialPeriod,
  resolveFinancialPeriodSelection,
  type StaffFinancialPeriod,
} from "@/utils/assistant-staff-tool-common";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";

export const EMPLOYEE_SEARCH_LIMIT = 10;
export const HR_ASSISTANT_LIST_LIMIT = 20;

export const ASSISTANT_EMPLOYEE_DIRECTORY_SELECT =
  "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position, department, phone, email, supervisor, shift, welfare_deduction_rate, department_ref:departments!employees_department_fkey(dept_code, department_name)";

export type AssistantEmployeeDirectoryRow = Pick<
  EmployeeRecord,
  | "employee_id"
  | "staff_id"
  | "full_name"
  | "employment_type"
  | "employment_status"
  | "date_hired"
  | "appointment_end_date"
  | "position"
  | "department"
  | "phone"
  | "email"
  | "supervisor"
  | "shift"
  | "welfare_deduction_rate"
  | "department_ref"
>;

export async function loadStaffBusinessUnitScope(): Promise<BusinessUnitReadScope> {
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);

  return resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
}

export async function fetchAssistantDirectoryEmployees(
  supabase: SupabaseClient,
  buScope: BusinessUnitReadScope,
): Promise<{
  employees: AssistantEmployeeDirectoryRow[];
  fetchError: string | null;
}> {
  const { data, error } = await applyBusinessUnitScope(
    supabase.from("employees").select(ASSISTANT_EMPLOYEE_DIRECTORY_SELECT),
    buScope,
  ).order("staff_id", { ascending: true });

  return {
    employees: (data as AssistantEmployeeDirectoryRow[] | null) ?? [],
    fetchError: error?.message ?? null,
  };
}

export function parseRequiredStringField(
  toolInput: unknown,
  fieldName: string,
): string | null {
  if (!toolInput || typeof toolInput !== "object") {
    return null;
  }

  const value = (toolInput as Record<string, unknown>)[fieldName];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseOptionalStringField(
  toolInput: unknown,
  fieldName: string,
): string | undefined {
  if (!toolInput || typeof toolInput !== "object") {
    return undefined;
  }

  const value = (toolInput as Record<string, unknown>)[fieldName];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveEmployeeInScope(
  employees: AssistantEmployeeDirectoryRow[],
  identifier: string,
): AssistantEmployeeDirectoryRow | null {
  const normalized = normalizeSearchText(identifier);

  return (
    employees.find(
      (employee) =>
        employee.employee_id === identifier ||
        normalizeSearchText(employee.staff_id) === normalized,
    ) ?? null
  );
}

export function resolveDepartmentDisplay(
  employee: AssistantEmployeeDirectoryRow,
): string {
  return getDepartmentName(new Map(), employee.department, employee.department_ref);
}

export function resolveSupervisorName(
  employees: AssistantEmployeeDirectoryRow[],
  supervisorId: string | null | undefined,
): string | null {
  if (!supervisorId?.trim()) {
    return null;
  }

  const supervisor = employees.find(
    (employee) => employee.employee_id === supervisorId.trim(),
  );

  return supervisor?.full_name?.trim() || supervisorId.trim();
}

export function searchEmployeesInScope(
  employees: AssistantEmployeeDirectoryRow[],
  query: string,
): AssistantEmployeeDirectoryRow[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return [];
  }

  return employees.filter((employee) => {
    const fullName = normalizeSearchText(employee.full_name ?? "");
    const staffId = normalizeSearchText(employee.staff_id ?? "");
    const departmentCode = normalizeSearchText(employee.department ?? "");
    const departmentName = normalizeSearchText(
      employee.department_ref?.department_name ?? "",
    );

    return (
      fullName.includes(normalizedQuery) ||
      staffId.includes(normalizedQuery) ||
      departmentCode.includes(normalizedQuery) ||
      departmentName.includes(normalizedQuery)
    );
  });
}

export function canAccessDisciplinaryRecords(role: AppRole | null): boolean {
  return role === "super_admin" || role === "hr" || role === "director";
}

export function resolveHrAssistantPeriodSelection(toolInput?: unknown): {
  period: StaffFinancialPeriod;
  monthKey: string;
  useYtd: boolean;
  periodLabel: string;
  year: number;
  month: number;
} {
  const period = parseFinancialPeriod(toolInput);
  const { year, month } = getCurrentCalendarMonth();
  const defaultMonthKey = `${year}-${String(month).padStart(2, "0")}`;
  const selection = resolveFinancialPeriodSelection(period, defaultMonthKey);

  return {
    period,
    ...selection,
  };
}
