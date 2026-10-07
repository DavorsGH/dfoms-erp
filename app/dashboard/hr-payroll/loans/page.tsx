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
import { fetchLoansAndAdvancesForRegister } from "@/app/dashboard/hr-payroll/loans-advances-register-fetch";
import { fetchScopedEmployeeIds } from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import LoansAndAdvancesRegister from "../loans-and-advances-register";
import type { LoanRegisterEntry } from "../loan-register-utils";
import type { SalaryAdvanceRegisterEntry } from "../salary-advance-register-utils";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../employee-utils";
import { mapApproverRows } from "../../approver-utils";
import type { Approver } from "../../lookup-types";
import HrPayrollShell from "../hr-payroll-shell";
import { loadActivePaymentAccountsForTenant } from "@/utils/payment-accounts-server";
import type { PaymentAccountRow } from "@/utils/payment-accounts-types";

const LOANS_EMPLOYEE_SELECT = `${HR_EMPLOYEE_SELECT}, business_unit_id`;

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

  let paymentAccounts: PaymentAccountRow[] = [];
  let paymentAccountsWarning: string | null = null;
  if (tenantId) {
    try {
      paymentAccounts = await loadActivePaymentAccountsForTenant(
        supabase,
        tenantId,
      );
    } catch (loadError) {
      paymentAccountsWarning =
        loadError instanceof Error
          ? "Paid-from accounts could not be loaded. You can still view loans and advances."
          : "Paid-from accounts could not be loaded. You can still view loans and advances.";
    }
  }

  const [
    loansAdvancesResult,
    { data: employees, error: employeesError },
    { data: approvers, error: approversError },
  ] = await Promise.all([
    tenantId
      ? fetchLoansAndAdvancesForRegister(supabase, tenantId, buScope)
      : Promise.resolve({ loans: [], advances: [], error: null }),
    applyBusinessUnitScope(
      supabase.from("employees").select(LOANS_EMPLOYEE_SELECT),
      buScope,
    ).order("full_name"),
    supabase
      .from("approvers")
      .select("employee_id, employees!approvers_employee_id_fkey(full_name)")
      .order("employee_id", { ascending: true }),
  ]);

  const loans = loansAdvancesResult.loans;
  const advances = loansAdvancesResult.advances;
  const loansError = loansAdvancesResult.error
    ? { message: loansAdvancesResult.error }
    : null;
  const advancesError = loansError;

  const fetchError =
    employeeScopeError ??
    loansError?.message ??
    advancesError?.message ??
    employeesError?.message ??
    approversError?.message ??
    (tenantId ? null : "Unable to resolve your workspace.");

  return (
    <HrPayrollShell sectionTitle="Loans & Advances">
      {tenantId ? (
        <LoansAndAdvancesRegister
          tenantId={tenantId}
          initialLoans={(loans as LoanRegisterEntry[] | null) ?? []}
          initialAdvances={(advances as SalaryAdvanceRegisterEntry[] | null) ?? []}
          initialEmployees={filterActiveEmployees(
            (employees as HrEmployee[] | null) ?? [],
          )}
          initialPaymentAccounts={paymentAccounts}
          initialApprovers={mapApproverRows(approvers ?? []) as Approver[]}
          activeBusinessUnitId={activeBusinessUnitId}
          viewAllBusinessUnits={viewAllBusinessUnits}
          fetchError={fetchError}
          paymentAccountsWarning={paymentAccountsWarning}
        />
      ) : (
        <p className="text-sm text-red-600">{fetchError}</p>
      )}
    </HrPayrollShell>
  );
}
