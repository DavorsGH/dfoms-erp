/**
 * Read-only: Dashboard widget BS check vs Finance Balance Sheet (Sep 2026).
 *   npx tsx scripts/probe-dashboard-vs-finance-bs-sep2026-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";
import { buildDashboardViewModel } from "../app/dashboard/dashboard-utils";

const FACILITIES_BU = "de215200-e92b-48e3-a7ba-977d7289868c";
const TENANT = "00000001-0000-4000-8000-000000000001";
const SEP = 8;

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const data = await fetchBalanceSheetPageData(admin, TENANT, {
    activeBusinessUnitId: FACILITIES_BU,
    viewAllBusinessUnits: false,
  });

  const opts = {
    tenantId: TENANT,
    accountsPayablePayments: data.initialAccountsPayablePayments,
    directorsLoanRepayments: data.initialDirectorsLoanRepayments,
  };

  const financeReport = buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    data.initialCashFlowExpenseEntries,
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
    2026,
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    data.initialWelfareFundEntries,
    opts,
  );

  const financeCheck = getBalanceCheckForPeriod(financeReport, SEP);
  const welfarePayable = getBalanceSheetAmountForMonth(
    financeReport.rows.find((row) => row.key === "staff-welfare-payable")!,
    SEP,
  );

  const vm = buildDashboardViewModel({
    incomeEntries: data.initialIncomeEntries.map((e) => ({
      date: e.date,
      amount: e.amount,
    })),
    productSaleEntries: data.initialIncomeEntries
      .filter((e) => e.entry_type === "product_sale")
      .map((e) => ({
        date: e.date,
        amount: e.amount,
        sale_status: e.sale_status,
      })),
    profitLossIncomeEntries: data.initialIncomeEntries.map((e) => ({
      date: e.date,
      service_category: e.service_category,
      amount: e.amount,
      entry_type: e.entry_type,
      sale_status: e.sale_status,
    })),
    balanceSheetIncomeEntries: data.initialIncomeEntries,
    expenseEntries: data.initialExpenseEntries.map((e) => ({
      date: e.date,
      amount: e.amount,
    })),
    profitLossExpenseEntries: data.initialExpenseEntries,
    fixedAssets: data.initialFixedAssets,
    payableEntries: data.initialPayableEntries,
    capitalContributions: data.initialCapitalContributions,
    cashFlowIncomeEntries: data.initialCashFlowIncomeEntries,
    cashFlowExpenseEntries: data.initialCashFlowExpenseEntries,
    payrollHistoryWages: data.initialPayrollHistory,
    monthEndCloseNetPay: data.initialMonthEndCloseNetPay,
    manualEntries: data.initialManualEntries,
    monthEndCloseRecords: data.initialMonthEndCloseRecords,
    payrollProcessingEntries: data.initialPayrollProcessingRows.map((e) => ({
      payroll_month: e.payroll_month,
      gross_pay: Number(e.gross_pay) || 0,
    })),
    payrollHistoryEntries: data.initialPayrollHistoryGrossEntries,
    inventoryBalanceSheetInput: data.initialInventoryBalanceSheet,
    taxLedgerEntries: data.initialTaxLedgerEntries,
    welfareFundEntries: data.initialWelfareFundEntries,
    balanceSheetReportOptions: opts,
    referenceDate: new Date("2026-09-07"),
  });

  const sepKey = vm.monthOptions.find((o) => o.year === 2026 && o.month === 9)?.key;
  const dashCheck = sepKey
    ? vm.monthSnapshots[sepKey]?.summary.balanceCheck
    : null;

  console.log(
    JSON.stringify(
      {
        facilities_bu_id: FACILITIES_BU,
        welfare_entries_in_loader: data.initialWelfareFundEntries.length,
        finance_balance_sheet_page_sep2026: {
          balanced: financeCheck.isBalanced,
          difference: financeCheck.difference,
          total_assets: financeCheck.totalAssets,
          total_liabilities_and_equity: financeCheck.totalLiabilitiesAndEquity,
          staff_welfare_payable: welfarePayable,
        },
        dashboard_widget_sep2026: dashCheck,
        widget_gap_equals_finance_welfare_payable:
          dashCheck &&
          Math.abs(Math.abs(dashCheck.difference) - welfarePayable) < 0.02,
        root_cause:
          "Dashboard buildCachedReportsForYear omits welfareFundEntries (defaults to [])",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
