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
import LoanRegister from "../loan-register";
import type { LoanRegisterEntry } from "../loan-register-utils";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../employee-utils";
import HrPayrollShell from "../hr-payroll-shell";

export default async function LoansPage() {
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
        supabase.from("loan_register").select("*"),
        employeeIds,
      ).order("date_issued", { ascending: false }),
      applyBusinessUnitScope(
        supabase.from("employees").select(HR_EMPLOYEE_SELECT),
        buScope,
      ).order("full_name"),
    ]);

  const fetchError =
    employeeScopeError ?? error?.message ?? employeesError?.message ?? null;

  return (
    <HrPayrollShell sectionTitle="Loan Register">
      <LoanRegister
        initialEntries={(data as LoanRegisterEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
