import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchMonthlyBalanceSheetReportData } from "../../finance-report-data";
import { MonthlyBalanceSheetReport } from "../../finance-reports";
import ReportsShell from "../../reports-shell";

export default async function MonthlyBalanceSheetReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchMonthlyBalanceSheetReportData(supabase);
  const {
    initialIncomeEntries,
    initialExpenseEntries,
    initialFixedAssets,
    initialPayableEntries,
    initialCapitalContributions,
    initialCashFlowExpenseEntries,
    initialPayrollHistory,
    initialMonthEndCloseNetPay,
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
        availableYears={availableYears}
        fetchError={fetchError}
      />
    </ReportsShell>
  );
}
