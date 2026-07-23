import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { fetchMonthlyBalanceSheetReportData } from "../../finance-report-data";
import { MonthlyBalanceSheetReport } from "../../finance-reports";
import ReportsShell from "../../reports-shell";

export default async function MonthlyBalanceSheetReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const data = await fetchMonthlyBalanceSheetReportData(supabase, tenantId);
  const {
    initialIncomeEntries,
    initialExpenseEntries,
    initialFixedAssets,
    initialPayableEntries,
    initialCapitalContributions,
    initialCashFlowExpenseEntries,
    initialPayrollHistory,
    initialMonthEndCloseNetPay,
    initialInventoryBalanceSheet,
    initialManualEntries,
    availableYears,
    fetchError,
  } = data;

  return (
    <ReportsShell sectionTitle="Monthly Balance Sheet">
      <MonthlyBalanceSheetReport
        initialIncomeEntries={initialIncomeEntries}
        initialExpenseEntries={initialExpenseEntries}
        initialFixedAssets={initialFixedAssets}
        initialPayableEntries={initialPayableEntries}
        initialCapitalContributions={initialCapitalContributions}
        initialCashFlowExpenseEntries={initialCashFlowExpenseEntries}
        initialPayrollHistory={initialPayrollHistory}
        initialMonthEndCloseNetPay={initialMonthEndCloseNetPay}
        initialInventoryBalanceSheet={initialInventoryBalanceSheet}
        initialManualEntries={initialManualEntries}
        availableYears={availableYears}
        fetchError={fetchError}
      />
    </ReportsShell>
  );
}
