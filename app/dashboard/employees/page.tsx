import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getCurrentUserRole,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  canEditEmployees,
  canViewEmployeeSalary,
} from "@/utils/rbac-access";
import HrPayrollShell from "../hr-payroll/hr-payroll-shell";
import EmployeesDirectory from "./employees-directory";
import type { EmployeeRecord } from "./employee-record-utils";
import { EMPLOYEE_SELECT } from "./employee-record-utils";
import {
  buildDepartmentNameMap,
  buildProjectNameMap,
  loadEmployeeLookups,
  loadEmployeePayConfig,
} from "./lookup-utils";
import { loadDirectoryNetPayContext } from "./directory-net-pay-utils";

export default async function EmployeesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  const employeeQuery = supabase
    .from("employees")
    .select(EMPLOYEE_SELECT)
    .order("staff_id", { ascending: true });
  if (tenantId) {
    employeeQuery.eq("tenant_id", tenantId);
  }

  const [{ data, error }, lookups, payConfig] = await Promise.all([
    employeeQuery,
    loadEmployeeLookups(supabase, tenantId),
    loadEmployeePayConfig(supabase, tenantId),
  ]);

  const employees = (data as EmployeeRecord[] | null) ?? [];
  const netPayContext = await loadDirectoryNetPayContext(
    supabase,
    tenantId,
    employees,
  );

  const role = (await getCurrentUserRole()) as AppRole | null;

  return (
    <HrPayrollShell sectionTitle="Employee Directory">
      <EmployeesDirectory
        initialEmployees={employees}
        initialLookups={lookups}
        initialPayConfig={payConfig}
        netPayByEmployeeId={netPayContext.netPayByEmployeeId}
        netPayPeriodLabel={netPayContext.periodLabel}
        departmentNameMap={buildDepartmentNameMap(lookups.departments)}
        projectNameMap={buildProjectNameMap(lookups.projects)}
        fetchError={error?.message ?? null}
        canEditEmployees={canEditEmployees(role)}
        canViewSalary={canViewEmployeeSalary(role)}
      />
    </HrPayrollShell>
  );
}
