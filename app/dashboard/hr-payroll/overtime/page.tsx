import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  applyEmployeeIdScope,
  fetchScopedEmployeeIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import { mapApproverRows } from "../../approver-utils";
import type { Approver } from "../../lookup-types";
import OvertimeRegister from "../overtime-register";
import type { OvertimeRegisterEntry } from "../overtime-register-utils";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../employee-utils";
import HrPayrollShell from "../hr-payroll-shell";

export default async function OvertimePage() {
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

  const [
    { data, error },
    { data: employees, error: employeesError },
    { data: approvers, error: approversError },
  ] = await Promise.all([
    applyEmployeeIdScope(
      supabase.from("overtime_register").select("*"),
      employeeIds,
    ).order("date", { ascending: false }),
    applyBusinessUnitScope(
      supabase.from("employees").select(HR_EMPLOYEE_SELECT),
      buScope,
    ).order("full_name"),
    supabase
      .from("approvers")
      .select("employee_id, employees!approvers_employee_id_fkey(full_name)")
      .order("employee_id", { ascending: true }),
  ]);

  const fetchError =
    employeeScopeError ??
    error?.message ??
    employeesError?.message ??
    approversError?.message ??
    null;

  return (
    <HrPayrollShell sectionTitle="Overtime Register">
      <OvertimeRegister
        initialEntries={(data as OvertimeRegisterEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        initialApprovers={mapApproverRows(approvers ?? []) as Approver[]}
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
