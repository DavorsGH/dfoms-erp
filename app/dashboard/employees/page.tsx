import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserRole,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
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
import {
  HR_PAYROLL_SETTINGS_SELECT,
  normalizeHrPayrollSettingsRow,
  type HrPayrollSettingsRow,
} from "@/utils/hr-payroll-settings-types";
import { scopeToBusinessUnitId } from "@/utils/phase5e-key-structure";

export default async function EmployeesPage() {
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

  let employeeQuery = supabase
    .from("employees")
    .select(EMPLOYEE_SELECT)
    .order("staff_id", { ascending: true });
  if (tenantId) {
    employeeQuery = employeeQuery.eq("tenant_id", tenantId);
  }
  employeeQuery = applyBusinessUnitScope(employeeQuery, buScope);

  const [{ data, error }, lookups, payConfig, hrPayrollSettingsResult] =
    await Promise.all([
    employeeQuery,
    loadEmployeeLookups(supabase, tenantId, buScope),
    loadEmployeePayConfig(supabase, tenantId),
    tenantId
      ? scopeToBusinessUnitId(
          supabase
            .from("hr_payroll_settings")
            .select(HR_PAYROLL_SETTINGS_SELECT)
            .eq("tenant_id", tenantId),
          activeBusinessUnitId,
        ).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const employees = (data as EmployeeRecord[] | null) ?? [];
  const netPayContext = await loadDirectoryNetPayContext(
    supabase,
    tenantId,
    employees,
  );

  const role = (await getCurrentUserRole()) as AppRole | null;
  const defaultWelfareDeductionRate =
    normalizeHrPayrollSettingsRow(
      hrPayrollSettingsResult.data as HrPayrollSettingsRow | null,
    )?.default_welfare_deduction_rate ?? null;

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
        fetchError={error?.message ?? hrPayrollSettingsResult.error?.message ?? null}
        canEditEmployees={canEditEmployees(role)}
        defaultWelfareDeductionRate={defaultWelfareDeductionRate}
        canViewSalary={canViewEmployeeSalary(role)}
        activeBusinessUnitId={activeBusinessUnitId}
      />
    </HrPayrollShell>
  );
}
