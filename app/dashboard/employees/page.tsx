import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
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

export default async function EmployeesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, lookups, payConfig] = await Promise.all([
    supabase.from("employees").select(EMPLOYEE_SELECT).order("staff_id", { ascending: true }),
    loadEmployeeLookups(supabase),
    loadEmployeePayConfig(supabase),
  ]);

  const role = (await getCurrentUserRole()) as AppRole | null;

  return (
    <HrPayrollShell sectionTitle="Employee Directory">
      <EmployeesDirectory
        initialEmployees={(data as EmployeeRecord[] | null) ?? []}
        initialLookups={lookups}
        initialPayConfig={payConfig}
        departmentNameMap={buildDepartmentNameMap(lookups.departments)}
        projectNameMap={buildProjectNameMap(lookups.projects)}
        fetchError={error?.message ?? null}
        canEditEmployees={canEditEmployees(role)}
        canViewSalary={canViewEmployeeSalary(role)}
      />
    </HrPayrollShell>
  );
}
