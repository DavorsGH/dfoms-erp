import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  applyEmployeeIdScope,
  fetchScopedEmployeeIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import LeaveManagement from "../leave-management";
import type { LeaveManagementEntry } from "../leave-management-utils";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../employee-utils";
import HrPayrollShell from "../hr-payroll-shell";

export default async function LeavePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const { employeeIds, error: employeeScopeError } = tenantId
    ? await fetchScopedEmployeeIds(supabase, tenantId, buScope)
    : {
        employeeIds: buScope.mode === "all" ? null : [],
        error:
          buScope.mode === "all"
            ? null
            : "Unable to resolve your workspace.",
      };

  const [{ data, error }, { data: employees, error: employeesError }] =
    await Promise.all([
      applyEmployeeIdScope(
        supabase.from("leave_management").select("*"),
        employeeIds,
      ).order("start_date", { ascending: false }),
      supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    ]);

  const fetchError =
    employeeScopeError ?? error?.message ?? employeesError?.message ?? null;

  return (
    <HrPayrollShell sectionTitle="Leave Management">
      <LeaveManagement
        initialEntries={(data as LeaveManagementEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        fetchError={fetchError}
        tenantId={tenantId}
      />
    </HrPayrollShell>
  );
}
