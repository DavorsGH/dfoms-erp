import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";
import type { LoanRegisterEntry } from "./loan-register-utils";
import type { SalaryAdvanceRegisterEntry } from "./salary-advance-register-utils";
import {
  applyEmployeeIdScope,
  fetchScopedEmployeeIds,
} from "./payroll-bu-scope-utils";

export type LoansAdvancesFetchResult = {
  loans: LoanRegisterEntry[];
  advances: SalaryAdvanceRegisterEntry[];
  error: string | null;
};

/**
 * Same scoping as HR → Loans & Advances SSR load: tenant + BU employee scope.
 */
export async function fetchLoansAndAdvancesForRegister(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<LoansAdvancesFetchResult> {
  const { employeeIds, error: scopeError } = await fetchScopedEmployeeIds(
    supabase,
    tenantId,
    buScope,
  );
  if (scopeError) {
    return { loans: [], advances: [], error: scopeError };
  }

  const [loanRes, advanceRes] = await Promise.all([
    applyEmployeeIdScope(
      supabase.from("loan_register").select("*"),
      employeeIds,
    ).order("date_issued", { ascending: false }),
    applyEmployeeIdScope(
      supabase
        .from("salary_advance_register")
        .select("*")
        .eq("tenant_id", tenantId),
      employeeIds,
    ).order("date_issued", { ascending: false }),
  ]);

  if (loanRes.error) {
    return { loans: [], advances: [], error: loanRes.error.message };
  }
  if (advanceRes.error) {
    return { loans: [], advances: [], error: advanceRes.error.message };
  }

  return {
    loans: (loanRes.data as LoanRegisterEntry[] | null) ?? [],
    advances: (advanceRes.data as SalaryAdvanceRegisterEntry[] | null) ?? [],
    error: null,
  };
}
