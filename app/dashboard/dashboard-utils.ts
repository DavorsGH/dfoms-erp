import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  type BalanceSheetAccountsPayableEntry,
  type BalanceSheetIncomeEntry,
} from "./finance/balance-sheet-utils";
import type { BalanceSheetCashExpenseEntry } from "./finance/accrued-wages-utils";
import type { PayrollHistoryWagesEntry } from "./finance/accrued-wages-utils";
import type { CapitalContributionEntry } from "./finance/capital-contributions-utils";
import type {
  CashFlowIncomeEntry,
  ManualFinancialEntry,
} from "./finance/cash-flow-utils";
import { MONTH_LABELS } from "./finance/profit-loss-utils";
import {
  buildProfitLossReport,
  getEntryMonthIndex,
  type ProfitLossAssetEntry,
  type ProfitLossExpenseEntry,
  type ProfitLossIncomeEntry,
} from "./finance/profit-loss-utils";
import {
  formatPeriodLabel,
  getPeriodEndDate,
  getPeriodStartDate,
  getPeriodDisplayStatus,
  isMonthClosed,
  type MonthEndCloseRecord,
} from "./hr-payroll/payroll-period-utils";

export type DashboardIncomeEntry = {
  date: string;
  amount: number;
};

export type DashboardExpenseEntry = {
  date: string;
  amount: number;
};

export type DashboardPayrollProcessingEntry = {
  payroll_month: string;
  gross_pay: number;
};

export type DashboardPayrollHistoryEntry = {
  payroll_month: string;
  gross_pay: number;
};

export type DashboardPayrollPayableEntry = {
  vendor_name: string;
  status: string | null;
  amount: number;
  invoice_date: string;
  description: string | null;
};

export type DashboardMonthPoint = {
  year: number;
  month: number;
  label: string;
  shortLabel: string;
};

export type DashboardSummaryCards = {
  periodLabel: string;
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  cashPosition: number;
  balanceCheck: {
    isBalanced: boolean;
    difference: number;
  };
};

export type DashboardProfitTrendPoint = {
  label: string;
  revenue: number;
  expenses: number;
  netProfit: number;
};

export type DashboardCashTrendPoint = {
  label: string;
  cash: number;
};

export type DashboardPayrollTrendPoint = {
  label: string;
  payrollCost: number;
};

export type DashboardPayrollPanel = {
  periodLabel: string;
  lockStatus: string;
  totalPayrollCost: number;
  pendingPayrollLiabilities: number;
  liabilityReferenceLabel: string | null;
  payrollNotProcessed: boolean;
  payrollTrend: DashboardPayrollTrendPoint[];
};

export type DashboardViewModel = {
  summary: DashboardSummaryCards;
  profitTrend: DashboardProfitTrendPoint[];
  cashTrend: DashboardCashTrendPoint[];
  payroll: DashboardPayrollPanel;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getCurrentCalendarMonth(referenceDate = new Date()): {
  year: number;
  month: number;
} {
  return {
    year: referenceDate.getFullYear(),
    month: referenceDate.getMonth() + 1,
  };
}

export function getLastSixCalendarMonths(
  referenceDate = new Date(),
): DashboardMonthPoint[] {
  const points: DashboardMonthPoint[] = [];

  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth() - offset,
      1,
    );
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    points.push({
      year,
      month,
      label: formatPeriodLabel(year, month),
      shortLabel: `${MONTH_LABELS[month - 1]} ${String(year).slice(-2)}`,
    });
  }

  return points;
}

function sumRegisterAmountForMonth(
  entries: Array<{ date: string; amount: number }>,
  year: number,
  month: number,
): number {
  return roundCurrency(
    entries.reduce((sum, entry) => {
      const monthIndex = getEntryMonthIndex(entry.date, year);
      if (monthIndex !== month - 1) {
        return sum;
      }

      return sum + (Number(entry.amount) || 0);
    }, 0),
  );
}

function getProfitLossRowAmount(
  report: ReturnType<typeof buildProfitLossReport>,
  rowKey: string,
  monthIndex: number,
): number {
  const row = report.rows.find((entry) => entry.key === rowKey);
  return row?.amounts[monthIndex] ?? 0;
}

function buildBalanceSheetReportForYear(
  incomeEntries: BalanceSheetIncomeEntry[],
  expenseEntries: ProfitLossExpenseEntry[],
  fixedAssets: ProfitLossAssetEntry[],
  payableEntries: BalanceSheetAccountsPayableEntry[],
  capitalContributions: CapitalContributionEntry[],
  cashFlowIncomeEntries: CashFlowIncomeEntry[],
  cashFlowExpenseEntries: BalanceSheetCashExpenseEntry[],
  payrollHistory: PayrollHistoryWagesEntry[],
  manualEntries: ManualFinancialEntry[],
  financialYear: number,
) {
  return buildBalanceSheetReport(
    incomeEntries,
    expenseEntries,
    fixedAssets,
    payableEntries,
    capitalContributions,
    cashFlowIncomeEntries,
    cashFlowExpenseEntries,
    payrollHistory,
    manualEntries,
    financialYear,
  );
}

function sumPayrollGrossForMonth(
  payrollMonth: string,
  processingEntries: DashboardPayrollProcessingEntry[],
  historyEntries: DashboardPayrollHistoryEntry[],
  closeRecord: MonthEndCloseRecord | null | undefined,
): number {
  const normalizedMonth = payrollMonth.slice(0, 10);

  if (isMonthClosed(closeRecord)) {
    return roundCurrency(
      historyEntries
        .filter((entry) => entry.payroll_month.slice(0, 10) === normalizedMonth)
        .reduce((sum, entry) => sum + (Number(entry.gross_pay) || 0), 0),
    );
  }

  return roundCurrency(
    processingEntries
      .filter((entry) => entry.payroll_month.slice(0, 10) === normalizedMonth)
      .reduce((sum, entry) => sum + (Number(entry.gross_pay) || 0), 0),
  );
}

function findMostRecentClosedPayrollMonth(
  monthEndCloseRecords: MonthEndCloseRecord[],
): MonthEndCloseRecord | null {
  return (
    monthEndCloseRecords
      .filter((record) => isMonthClosed(record))
      .sort((left, right) => right.month.localeCompare(left.month))[0] ?? null
  );
}

function sumPendingPayrollLiabilities(
  payables: DashboardPayrollPayableEntry[],
  payrollMonth: string,
): number {
  const periodEnd = getPeriodEndDate(
    Number(payrollMonth.slice(0, 4)),
    Number(payrollMonth.slice(5, 7)),
  );
  const monthLabel = formatPeriodLabel(
    Number(payrollMonth.slice(0, 4)),
    Number(payrollMonth.slice(5, 7)),
  );

  return roundCurrency(
    payables.reduce((sum, payable) => {
      const vendor = payable.vendor_name?.trim();
      if (vendor !== "SSNIT" && vendor !== "GRA") {
        return sum;
      }

      if ((payable.status ?? "").trim() !== "Unpaid") {
        return sum;
      }

      const invoiceDate = payable.invoice_date.slice(0, 10);
      const description = payable.description ?? "";
      const matchesMonth =
        invoiceDate === periodEnd || description.includes(monthLabel);

      if (!matchesMonth) {
        return sum;
      }

      return sum + (Number(payable.amount) || 0);
    }, 0),
  );
}

function getCurrentMonthCloseRecord(
  monthEndCloseRecords: MonthEndCloseRecord[],
  year: number,
  month: number,
): MonthEndCloseRecord | null {
  const payrollMonth = getPeriodStartDate(year, month);
  return (
    monthEndCloseRecords.find(
      (record) => record.month.slice(0, 10) === payrollMonth,
    ) ?? null
  );
}

function monthHasPayrollActivity(
  payrollMonth: string,
  processingEntries: DashboardPayrollProcessingEntry[],
  historyEntries: DashboardPayrollHistoryEntry[],
): boolean {
  const normalizedMonth = payrollMonth.slice(0, 10);

  return (
    processingEntries.some(
      (entry) => entry.payroll_month.slice(0, 10) === normalizedMonth,
    ) ||
    historyEntries.some(
      (entry) => entry.payroll_month.slice(0, 10) === normalizedMonth,
    )
  );
}

export function buildDashboardViewModel(input: {
  incomeEntries: DashboardIncomeEntry[];
  profitLossIncomeEntries: ProfitLossIncomeEntry[];
  balanceSheetIncomeEntries: BalanceSheetIncomeEntry[];
  expenseEntries: DashboardExpenseEntry[];
  profitLossExpenseEntries: ProfitLossExpenseEntry[];
  fixedAssets: ProfitLossAssetEntry[];
  payableEntries: BalanceSheetAccountsPayableEntry[];
  capitalContributions: CapitalContributionEntry[];
  cashFlowIncomeEntries: CashFlowIncomeEntry[];
  cashFlowExpenseEntries: BalanceSheetCashExpenseEntry[];
  payrollHistoryWages: PayrollHistoryWagesEntry[];
  manualEntries: ManualFinancialEntry[];
  monthEndCloseRecords: MonthEndCloseRecord[];
  payrollProcessingEntries: DashboardPayrollProcessingEntry[];
  payrollHistoryEntries: DashboardPayrollHistoryEntry[];
  payrollPayables: DashboardPayrollPayableEntry[];
  referenceDate?: Date;
}): DashboardViewModel {
  const referenceDate = input.referenceDate ?? new Date();
  const { year, month } = getCurrentCalendarMonth(referenceDate);
  const currentMonthIndex = month - 1;
  const periodLabel = formatPeriodLabel(year, month);
  const trendMonths = getLastSixCalendarMonths(referenceDate);
  const profitLossReport = buildProfitLossReport(
    input.profitLossIncomeEntries,
    input.profitLossExpenseEntries,
    input.fixedAssets,
    year,
  );
  const balanceSheetReport = buildBalanceSheetReportForYear(
    input.balanceSheetIncomeEntries,
    input.profitLossExpenseEntries,
    input.fixedAssets,
    input.payableEntries,
    input.capitalContributions,
    input.cashFlowIncomeEntries,
    input.cashFlowExpenseEntries,
    input.payrollHistoryWages,
    input.manualEntries,
    year,
  );
  const balanceCheck = getBalanceCheckForPeriod(
    balanceSheetReport,
    currentMonthIndex,
  );
  const cashRow = balanceSheetReport.rows.find((row) => row.key === "cash");

  const currentCloseRecord = getCurrentMonthCloseRecord(
    input.monthEndCloseRecords,
    year,
    month,
  );
  const currentPayrollMonth = getPeriodStartDate(year, month);
  const hasCurrentPayrollActivity = monthHasPayrollActivity(
    currentPayrollMonth,
    input.payrollProcessingEntries,
    input.payrollHistoryEntries,
  );
  const payrollNotProcessed =
    !isMonthClosed(currentCloseRecord) && !hasCurrentPayrollActivity;

  const latestClosedPayroll = findMostRecentClosedPayrollMonth(
    input.monthEndCloseRecords,
  );
  const liabilityReferenceLabel = latestClosedPayroll
    ? formatPeriodLabel(
        Number(latestClosedPayroll.month.slice(0, 4)),
        Number(latestClosedPayroll.month.slice(5, 7)),
      )
    : null;

  const profitTrend = trendMonths.map((point) => {
    const monthIndex = point.month - 1;
    const report =
      point.year === year
        ? profitLossReport
        : buildProfitLossReport(
            input.profitLossIncomeEntries,
            input.profitLossExpenseEntries,
            input.fixedAssets,
            point.year,
          );

    return {
      label: point.shortLabel,
      revenue: getProfitLossRowAmount(report, "total-revenue", monthIndex),
      expenses: getProfitLossRowAmount(report, "total-expenses", monthIndex),
      netProfit: getProfitLossRowAmount(report, "net-profit", monthIndex),
    };
  });

  const cashTrend = trendMonths.map((point) => {
    const monthIndex = point.month - 1;
    const report =
      point.year === year
        ? balanceSheetReport
        : buildBalanceSheetReportForYear(
            input.balanceSheetIncomeEntries,
            input.profitLossExpenseEntries,
            input.fixedAssets,
            input.payableEntries,
            input.capitalContributions,
            input.cashFlowIncomeEntries,
            input.cashFlowExpenseEntries,
            input.payrollHistoryWages,
            input.manualEntries,
            point.year,
          );
    const cashAmounts = report.rows.find((row) => row.key === "cash")?.amounts;

    return {
      label: point.shortLabel,
      cash: cashAmounts?.[monthIndex] ?? 0,
    };
  });

  const payrollTrend = trendMonths.map((point) => {
    const payrollMonth = getPeriodStartDate(point.year, point.month);
    const closeRecord = getCurrentMonthCloseRecord(
      input.monthEndCloseRecords,
      point.year,
      point.month,
    );

    return {
      label: point.shortLabel,
      payrollCost: sumPayrollGrossForMonth(
        payrollMonth,
        input.payrollProcessingEntries,
        input.payrollHistoryEntries,
        closeRecord,
      ),
    };
  });

  return {
    summary: {
      periodLabel,
      totalRevenue: sumRegisterAmountForMonth(input.incomeEntries, year, month),
      totalExpenses: sumRegisterAmountForMonth(
        input.expenseEntries,
        year,
        month,
      ),
      netProfit: getProfitLossRowAmount(
        profitLossReport,
        "net-profit",
        currentMonthIndex,
      ),
      cashPosition: cashRow?.amounts[currentMonthIndex] ?? 0,
      balanceCheck: {
        isBalanced: balanceCheck.isBalanced,
        difference: balanceCheck.difference,
      },
    },
    profitTrend,
    cashTrend,
    payroll: {
      periodLabel,
      lockStatus: getPeriodDisplayStatus(
        currentCloseRecord,
        hasCurrentPayrollActivity,
      ),
      totalPayrollCost: sumPayrollGrossForMonth(
        currentPayrollMonth,
        input.payrollProcessingEntries,
        input.payrollHistoryEntries,
        currentCloseRecord,
      ),
      pendingPayrollLiabilities: latestClosedPayroll
        ? sumPendingPayrollLiabilities(
            input.payrollPayables,
            latestClosedPayroll.month,
          )
        : 0,
      liabilityReferenceLabel,
      payrollNotProcessed,
      payrollTrend,
    },
  };
}
