import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import BalanceSheet from "../balance-sheet";
import { fetchBalanceSheetPageData } from "../balance-sheet-page-data";
import BalanceSheetShell from "../balance-sheet-shell";

type BalanceSheetPageProps = {
  searchParams: Promise<{ focusMonth?: string; year?: string }>;
};

export default async function BalanceSheetPage({ searchParams }: BalanceSheetPageProps) {
  const { focusMonth: focusMonthParam, year: yearParam } = await searchParams;
  const parsedFocusMonth = focusMonthParam ? Number(focusMonthParam) : null;
  const initialFocusMonth =
    parsedFocusMonth !== null &&
    Number.isInteger(parsedFocusMonth) &&
    parsedFocusMonth >= 0 &&
    parsedFocusMonth <= 11
      ? parsedFocusMonth
      : null;
  const parsedYear = yearParam ? Number(yearParam) : null;
  const initialFocusYear =
    parsedYear !== null && Number.isInteger(parsedYear) && parsedYear >= 2000
      ? parsedYear
      : null;

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const data = await fetchBalanceSheetPageData(supabase, tenantId, {
    activeBusinessUnitId,
    viewAllBusinessUnits,
  });
  const {
    tenantId: resolvedTenantId,
    initialIncomeEntries,
    initialExpenseEntries,
    initialFixedAssets,
    initialPayableEntries,
    initialAccountsPayablePayments,
    initialDirectorsLoanRepayments,
    initialCapitalContributions,
    initialCashFlowExpenseEntries,
    initialPayrollHistory,
    initialMonthEndCloseNetPay,
    initialInventoryBalanceSheet,
    initialManualEntries,
    initialTaxLedgerEntries,
    availableYears,
    fetchError,
  } = data;

  return (
    <BalanceSheetShell>
      <BalanceSheet
        tenantId={resolvedTenantId}
        initialIncomeEntries={initialIncomeEntries}
        initialExpenseEntries={initialExpenseEntries}
        initialFixedAssets={initialFixedAssets}
        initialPayableEntries={initialPayableEntries}
        initialAccountsPayablePayments={initialAccountsPayablePayments}
        initialDirectorsLoanRepayments={initialDirectorsLoanRepayments}
        initialCapitalContributions={initialCapitalContributions}
        initialCashFlowExpenseEntries={initialCashFlowExpenseEntries}
        initialPayrollHistory={initialPayrollHistory}
        initialMonthEndCloseNetPay={initialMonthEndCloseNetPay}
        initialInventoryBalanceSheet={initialInventoryBalanceSheet}
        initialManualEntries={initialManualEntries}
        initialTaxLedgerEntries={initialTaxLedgerEntries}
        availableYears={availableYears}
        fetchError={fetchError}
        initialFocusMonth={initialFocusMonth}
        initialFocusYear={initialFocusYear}
      />
    </BalanceSheetShell>
  );
}
