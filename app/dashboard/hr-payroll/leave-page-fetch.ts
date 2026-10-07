import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  applyEmployeeIdScope,
  fetchScopedEmployeeIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import {
  HR_EMPLOYEE_SELECT,
  type HrEmployee,
} from "./employee-utils";
import type { LeaveManagementEntry } from "./leave-management-utils";

export type LeavePageFetchResult = {
  entries: LeaveManagementEntry[];
  employees: HrEmployee[];
  leaveTypeOptions: string[];
  error: string | null;
};

/** SSR + isolation tests: tenant + BU scoped leave management load. */
export async function fetchLeavePageData(
  supabase: SupabaseClient,
  tenantId: string | null,
  buScope: BusinessUnitReadScope,
): Promise<LeavePageFetchResult> {
  const { employeeIds, error: employeeScopeError } = tenantId
    ? await fetchScopedEmployeeIds(supabase, tenantId, buScope)
    : {
        employeeIds: buScope.mode === "all" ? null : [],
        error:
          buScope.mode === "all"
            ? null
            : "Unable to resolve your workspace.",
      };

  if (employeeScopeError) {
    return {
      entries: [],
      employees: [],
      leaveTypeOptions: [],
      error: employeeScopeError,
    };
  }

  const [
    { data, error: entriesError },
    { data: employees, error: employeesError },
    { data: leaveTypes, error: leaveTypesError },
  ] = await Promise.all([
    applyEmployeeIdScope(
      supabase.from("leave_management").select("*"),
      employeeIds,
    ).order("start_date", { ascending: false }),
    tenantId
      ? applyBusinessUnitScope(
          supabase
            .from("employees")
            .select(HR_EMPLOYEE_SELECT)
            .eq("tenant_id", tenantId),
          buScope,
        ).order("full_name")
      : Promise.resolve({ data: [], error: null }),
    tenantId
      ? supabase
          .from("leave_types")
          .select("type_name")
          .eq("tenant_id", tenantId)
          .order("type_name")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const leaveTypeOptions = (
    (leaveTypes as Array<{ type_name: string }> | null) ?? []
  ).map((row) => row.type_name);

  const error =
    entriesError?.message ??
    employeesError?.message ??
    leaveTypesError?.message ??
    null;

  return {
    entries: (data as LeaveManagementEntry[] | null) ?? [],
    employees: (employees as HrEmployee[] | null) ?? [],
    leaveTypeOptions,
    error,
  };
}
