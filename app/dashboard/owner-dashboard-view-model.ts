import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardPageData } from "@/app/dashboard/dashboard-page-data";
import {
  toSpendingAnalysisExpenseRows,
  toSpendingAnalysisIncomeRows,
} from "@/app/dashboard/dashboard-spending-analysis-utils";
import { buildDashboardViewModel, type DashboardViewModel } from "@/app/dashboard/dashboard-utils";
import { buildDashboardBudgetStatusByMonthKey } from "@/app/dashboard/dashboard-budget-status-utils";
import {
  fetchScopedRawMaterialStock,
  mergeScopedStockOntoMaterials,
} from "@/app/dashboard/inventory/raw-material-bu-stock-utils";
import { countLowStockRawMaterials } from "@/app/dashboard/reports/inventory-reports-utils";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";

export type BuildOwnerDashboardViewModelOptions = {
  /** Required to overlay BU-scoped RM stock onto the low-stock alert count. */
  supabase: SupabaseClient;
  buScope: BusinessUnitReadScope;
};

/**
 * Builds display-only dashboard widget aggregates from the same loader pipeline
 * as the owner dashboard page. Does NOT expose raw ledger register rows.
 */
export async function buildOwnerDashboardViewModel(
  dashboardPageData: DashboardPageData,
  tenantId: string,
  options: BuildOwnerDashboardViewModelOptions,
): Promise<DashboardViewModel> {
  const {
    initialIncomeEntries: incomeEntries,
    initialExpenseEntries: expenseEntries,
    initialFixedAssets: fixedAssets,
    initialPayableEntries: payableEntries,
    initialAccountsPayablePayments: accountsPayablePayments,
    initialDirectorsLoanRepayments: directorsLoanRepayments,
    initialCapitalContributions: capitalContributions,
    initialCashFlowExpenseEntries: cashFlowExpenseEntries,
    initialPayrollHistory: payrollHistoryWages,
    initialMonthEndCloseNetPay: monthEndCloseNetPay,
    initialMonthEndCloseRecords: monthEndCloseRecords,
    initialPayrollProcessingRows: payrollProcessingEntries,
    initialPayrollHistoryGrossEntries: payrollHistoryGrossEntries,
    initialManualEntries: manualEntries,
    initialInventoryBalanceSheet: inventoryBalanceSheetInput,
    initialTaxLedgerEntries: taxLedgerEntries,
    salesAnalysisEntries,
    budgetVsActualReportData,
  } = dashboardPageData;

  const { stockMap: rawMaterialStockMap } = await fetchScopedRawMaterialStock(
    options.supabase,
    tenantId,
    options.buScope,
  );
  const lowStockRawMaterialCount = countLowStockRawMaterials(
    mergeScopedStockOntoMaterials(
      inventoryBalanceSheetInput.rawMaterials,
      rawMaterialStockMap,
      options.buScope.mode,
    ),
  );

  const balanceSheetReportOptions = {
    tenantId,
    accountsPayablePayments,
    directorsLoanRepayments,
  };

  const dashboardData = buildDashboardViewModel({
    incomeEntries:
      incomeEntries?.map((entry) => ({
        date: entry.date,
        amount: entry.amount,
      })) ?? [],
    productSaleEntries:
      incomeEntries
        ?.filter((entry) => entry.entry_type === "product_sale")
        .map((entry) => ({
          date: entry.date,
          amount: entry.amount,
          sale_status: entry.sale_status,
        })) ?? [],
    profitLossIncomeEntries:
      incomeEntries?.map((entry) => {
        const row = entry as typeof entry & {
          net_of_tax_amount?: number | null;
          output_vat_amount?: number | null;
        };
        return {
          date: row.date,
          service_category: row.service_category,
          amount: row.amount,
          entry_type: row.entry_type,
          sale_status: row.sale_status,
          net_of_tax_amount: row.net_of_tax_amount,
          output_vat_amount: row.output_vat_amount,
        };
      }) ?? [],
    balanceSheetIncomeEntries: incomeEntries ?? [],
    expenseEntries:
      expenseEntries?.map((entry) => ({
        date: entry.date,
        amount: entry.amount,
      })) ?? [],
    profitLossExpenseEntries: expenseEntries ?? [],
    fixedAssets: fixedAssets ?? [],
    payableEntries: payableEntries ?? [],
    capitalContributions: capitalContributions ?? [],
    cashFlowIncomeEntries: dashboardPageData.initialCashFlowIncomeEntries,
    cashFlowExpenseEntries,
    payrollHistoryWages,
    monthEndCloseNetPay,
    manualEntries: manualEntries ?? [],
    monthEndCloseRecords: monthEndCloseRecords ?? [],
    payrollProcessingEntries:
      payrollProcessingEntries?.map((entry) => ({
        payroll_month: entry.payroll_month,
        gross_pay: Number(entry.gross_pay) || 0,
      })) ?? [],
    payrollHistoryEntries: payrollHistoryGrossEntries,
    lowStockRawMaterialCount,
    inventoryBalanceSheetInput,
    taxLedgerEntries: taxLedgerEntries ?? [],
    balanceSheetReportOptions,
  });

  return {
    ...dashboardData,
    spendingAnalysisIncome: toSpendingAnalysisIncomeRows(incomeEntries ?? []),
    spendingAnalysisExpenses: toSpendingAnalysisExpenseRows(expenseEntries ?? []),
    salesAnalysisEntries,
    budgetStatusByMonthKey: buildDashboardBudgetStatusByMonthKey(
      budgetVsActualReportData,
      dashboardData.monthOptions,
    ),
  };
}
