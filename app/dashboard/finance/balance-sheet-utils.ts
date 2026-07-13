import {
  calculateShareCapitalByMonth,
  getMonthEndDate,
  type CapitalContributionEntry,
} from "./capital-contributions-utils";
import { buildCashFlowReport } from "./cash-flow-utils";
import type {
  CashFlowExpenseEntry,
  CashFlowIncomeEntry,
  ManualFinancialEntry,
} from "./cash-flow-utils";
import { calculateMonthlyNetBookValueTotals } from "./fixed-assets-utils";
import {
  buildBalanceSheetCashFlowExpenses,
  calculateAccruedWagesPayableByMonth,
  type BalanceSheetCashExpenseEntry,
  type PayrollHistoryWagesEntry,
} from "./accrued-wages-utils";
import {
  FULL_YEAR_INDEX,
  MONTH_LABELS,
  buildProfitLossReport,
  createEmptyMonthlyTotals,
  sumMonthlyTotals,
  type MonthlyTotals,
  type ProfitLossAssetEntry,
  type ProfitLossExpenseEntry,
  type ProfitLossIncomeEntry,
} from "./profit-loss-utils";
import { getCurrentFinancialYear } from "./finance-year-utils";

export { MONTH_LABELS, FULL_YEAR_INDEX } from "./profit-loss-utils";

export const BALANCE_TOLERANCE = 0.01;

export type BalanceSheetAccountsPayableEntry = {
  invoice_date: string;
  balance_due: number | null;
  amount: number;
  amount_paid: number;
};

export type BalanceSheetIncomeEntry = {
  date: string;
  amount: number;
  amount_received: number;
  outstanding_balance: number | null;
  service_category: string;
};

export type BalanceSheetRow = {
  key: string;
  label: string;
  amounts: MonthlyTotals;
  kind: "section" | "data" | "subtotal" | "total";
  side?: "assets" | "liabilities" | "equity" | "combined";
};

export type BalanceSheetReport = {
  financialYear: number;
  rows: BalanceSheetRow[];
  totalAssets: MonthlyTotals;
  totalLiabilities: MonthlyTotals;
  totalEquity: MonthlyTotals;
  totalLiabilitiesAndEquity: MonthlyTotals;
};

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

function getOutstandingBalance(entry: BalanceSheetIncomeEntry): number {
  if (entry.outstanding_balance !== null && entry.outstanding_balance !== undefined) {
    return Number(entry.outstanding_balance) || 0;
  }

  return Math.max(
    (Number(entry.amount) || 0) - (Number(entry.amount_received) || 0),
    0,
  );
}

function getPayableBalance(entry: BalanceSheetAccountsPayableEntry): number {
  if (entry.balance_due !== null && entry.balance_due !== undefined) {
    return Math.max(Number(entry.balance_due) || 0, 0);
  }

  return Math.max((Number(entry.amount) || 0) - (Number(entry.amount_paid) || 0), 0);
}

function calculateAccountsReceivableByMonth(
  incomeEntries: BalanceSheetIncomeEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);

    totals[month - 1] = incomeEntries.reduce((sum, entry) => {
      const entryDate = normalizeDate(entry.date);
      if (!entryDate || entryDate > monthEnd) {
        return sum;
      }

      return sum + getOutstandingBalance(entry);
    }, 0);
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

function calculateAccountsPayableByMonth(
  payableEntries: BalanceSheetAccountsPayableEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);

    totals[month - 1] = payableEntries.reduce((sum, entry) => {
      const entryDate = normalizeDate(entry.invoice_date);
      if (!entryDate || entryDate > monthEnd) {
        return sum;
      }

      return sum + getPayableBalance(entry);
    }, 0);
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

function calculateFixedAssetsNetByMonth(
  fixedAssets: ProfitLossAssetEntry[],
  financialYear: number,
): MonthlyTotals {
  return calculateMonthlyNetBookValueTotals(fixedAssets, financialYear);
}

function calculateRetainedEarningsByMonth(
  incomeEntries: ProfitLossIncomeEntry[],
  expenseEntries: ProfitLossExpenseEntry[],
  fixedAssets: ProfitLossAssetEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  const report = buildProfitLossReport(
    incomeEntries,
    expenseEntries,
    fixedAssets,
    financialYear,
  );
  const netProfitRow = report.rows.find((row) => row.key === "net-profit");

  if (!netProfitRow) {
    return totals;
  }

  let cumulative = 0;

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    cumulative += netProfitRow.amounts[monthIndex] ?? 0;
    totals[monthIndex] = cumulative;
  }

  totals[FULL_YEAR_INDEX] = cumulative;
  return totals;
}

function extractCashBalances(
  incomeEntries: CashFlowIncomeEntry[],
  expenseEntries: BalanceSheetCashExpenseEntry[],
  payrollHistory: PayrollHistoryWagesEntry[],
  manualEntries: ManualFinancialEntry[],
  financialYear: number,
): MonthlyTotals {
  const cashFlowExpenses = buildBalanceSheetCashFlowExpenses(
    expenseEntries,
    payrollHistory,
  );
  const report = buildCashFlowReport(
    incomeEntries,
    cashFlowExpenses,
    manualEntries,
    financialYear,
  );
  const closingRow = report.rows.find((row) => row.key === "closing-cash-balance");

  return closingRow?.amounts ?? createEmptyMonthlyTotals();
}

export function getBalanceCheckForPeriod(
  report: BalanceSheetReport,
  periodIndex = FULL_YEAR_INDEX,
) {
  const totalAssets = report.totalAssets[periodIndex] ?? 0;
  const totalLiabilitiesAndEquity =
    report.totalLiabilitiesAndEquity[periodIndex] ?? 0;
  const difference = totalAssets - totalLiabilitiesAndEquity;
  const isBalanced = Math.abs(difference) <= BALANCE_TOLERANCE;

  return {
    totalAssets,
    totalLiabilitiesAndEquity,
    difference,
    isBalanced,
  };
}

export function buildBalanceSheetReport(
  incomeEntries: BalanceSheetIncomeEntry[],
  expenseEntries: ProfitLossExpenseEntry[],
  fixedAssets: ProfitLossAssetEntry[],
  payableEntries: BalanceSheetAccountsPayableEntry[],
  capitalContributions: CapitalContributionEntry[],
  cashFlowIncomeEntries: CashFlowIncomeEntry[],
  cashFlowExpenseEntries: BalanceSheetCashExpenseEntry[],
  payrollHistory: PayrollHistoryWagesEntry[],
  manualEntries: ManualFinancialEntry[],
  financialYear = getCurrentFinancialYear(),
): BalanceSheetReport {
  const cash = extractCashBalances(
    cashFlowIncomeEntries,
    cashFlowExpenseEntries,
    payrollHistory,
    manualEntries,
    financialYear,
  );
  const accountsReceivable = calculateAccountsReceivableByMonth(
    incomeEntries,
    financialYear,
  );
  const fixedAssetsNet = calculateFixedAssetsNetByMonth(
    fixedAssets,
    financialYear,
  );
  const totalAssets = sumMonthlyTotals([
    cash,
    accountsReceivable,
    fixedAssetsNet,
  ]);

  const accountsPayable = calculateAccountsPayableByMonth(
    payableEntries,
    financialYear,
  );
  const accruedWagesPayable = calculateAccruedWagesPayableByMonth(
    payrollHistory,
    cashFlowExpenseEntries,
    financialYear,
  );
  const totalLiabilities = sumMonthlyTotals([
    accountsPayable,
    accruedWagesPayable,
  ]);

  const shareCapital = calculateShareCapitalByMonth(
    capitalContributions,
    financialYear,
  );
  const retainedEarnings = calculateRetainedEarningsByMonth(
    incomeEntries,
    expenseEntries,
    fixedAssets,
    financialYear,
  );
  const totalEquity = sumMonthlyTotals([shareCapital, retainedEarnings]);
  const totalLiabilitiesAndEquity = sumMonthlyTotals([
    accountsPayable,
    accruedWagesPayable,
    shareCapital,
    retainedEarnings,
  ]);

  const rows: BalanceSheetRow[] = [
    {
      key: "assets-section",
      label: "ASSETS",
      amounts: createEmptyMonthlyTotals(),
      kind: "section",
      side: "assets",
    },
    {
      key: "cash",
      label: "Cash and Cash Equivalents",
      amounts: cash,
      kind: "data",
      side: "assets",
    },
    {
      key: "accounts-receivable",
      label: "Accounts Receivable",
      amounts: accountsReceivable,
      kind: "data",
      side: "assets",
    },
    {
      key: "fixed-assets-net",
      label: "Fixed Assets (Net)",
      amounts: fixedAssetsNet,
      kind: "data",
      side: "assets",
    },
    {
      key: "total-assets",
      label: "TOTAL ASSETS",
      amounts: totalAssets,
      kind: "subtotal",
      side: "assets",
    },
    {
      key: "liabilities-section",
      label: "LIABILITIES",
      amounts: createEmptyMonthlyTotals(),
      kind: "section",
      side: "liabilities",
    },
    {
      key: "accounts-payable",
      label: "Accounts Payable",
      amounts: accountsPayable,
      kind: "data",
      side: "liabilities",
    },
    {
      key: "accrued-wages-payable",
      label: "Accrued Wages Payable",
      amounts: accruedWagesPayable,
      kind: "data",
      side: "liabilities",
    },
    {
      key: "total-liabilities",
      label: "TOTAL LIABILITIES",
      amounts: totalLiabilities,
      kind: "subtotal",
      side: "liabilities",
    },
    {
      key: "equity-section",
      label: "EQUITY",
      amounts: createEmptyMonthlyTotals(),
      kind: "section",
      side: "equity",
    },
    {
      key: "share-capital",
      label: "Share Capital",
      amounts: shareCapital,
      kind: "data",
      side: "equity",
    },
    {
      key: "retained-earnings",
      label: "Retained Earnings",
      amounts: retainedEarnings,
      kind: "data",
      side: "equity",
    },
    {
      key: "total-equity",
      label: "TOTAL EQUITY",
      amounts: totalEquity,
      kind: "subtotal",
      side: "equity",
    },
    {
      key: "total-liabilities-equity",
      label: "TOTAL LIABILITIES + EQUITY",
      amounts: totalLiabilitiesAndEquity,
      kind: "total",
      side: "combined",
    },
  ];

  return {
    financialYear,
    rows,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalLiabilitiesAndEquity,
  };
}
