import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  applyEmployeeIdScope,
  fetchScopedEmployeeIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import {
  HR_EMPLOYEE_SELECT,
  type HrEmployee,
} from "./employee-utils";
import type {
  EmployeeLeaveBalance,
  LeaveType,
} from "../self-service/leave-request-utils";

export type LeaveBalancesPageFetchResult = {
  balances: EmployeeLeaveBalance[];
  employees: HrEmployee[];
  leaveTypes: LeaveType[];
  error: string | null;
};

/** SSR + isolation tests: tenant + BU scoped leave balances load. */
export async function fetchLeaveBalancesPageData(
  supabase: SupabaseClient,
  tenantId: string | null,
  buScope: BusinessUnitReadScope,
  currentYear: number,
): Promise<LeaveBalancesPageFetchResult> {
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
      balances: [],
      employees: [],
      leaveTypes: [],
      error: employeeScopeError,
    };
  }

  const [
    { data: balances, error: balancesError },
    { data: employees, error: employeesError },
    { data: leaveTypes, error: typesError },
  ] = await Promise.all([
    applyEmployeeIdScope(
      supabase
        .from("employee_leave_balances")
        .select(
          "*, leave_types(type_name), employees!employee_leave_balances_employee_id_fkey(full_name, staff_id)",
        )
        .eq("year", currentYear),
      employeeIds,
    ).order("employee_id"),
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
          .select("*")
          .eq("tenant_id", tenantId)
          .order("type_name")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const error =
    balancesError?.message ??
    employeesError?.message ??
    typesError?.message ??
    null;

  return {
    balances: (balances as EmployeeLeaveBalance[] | null) ?? [],
    employees: (employees as HrEmployee[] | null) ?? [],
    leaveTypes: (leaveTypes as LeaveType[] | null) ?? [],
    error,
  };
}
