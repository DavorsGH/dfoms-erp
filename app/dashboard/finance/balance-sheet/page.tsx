import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import BalanceSheet from "../balance-sheet";
import { fetchBalanceSheetPageData } from "../balance-sheet-page-data";
import BalanceSheetShell from "../balance-sheet-shell";

export default async function BalanceSheetPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchBalanceSheetPageData(supabase);
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
    availableYears,
    fetchError,
  } = data;

  return (
    <BalanceSheetShell>
      <BalanceSheet
        initialIncomeEntries={initialIncomeEntries}
        initialExpenseEntries={initialExpenseEntries}
        initialFixedAssets={initialFixedAssets}
        initialPayableEntries={initialPayableEntries}
        initialCapitalContributions={initialCapitalContributions}
        initialCashFlowExpenseEntries={initialCashFlowExpenseEntries}
        initialPayrollHistory={initialPayrollHistory}
        initialMonthEndCloseNetPay={initialMonthEndCloseNetPay}
        initialInventoryBalanceSheet={initialInventoryBalanceSheet}
        availableYears={availableYears}
        fetchError={fetchError}
      />
    </BalanceSheetShell>
  );
}
