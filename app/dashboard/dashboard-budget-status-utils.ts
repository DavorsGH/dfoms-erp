import {
  buildAnnualPeriodMonth,
  isAnnualBudget,
  normalizePeriodMonth,
  type BudgetRecord,
} from "./finance/budget-utils";
import { getPeriodMonthParts } from "./finance/cash-flow-utils";
import { formatPeriodLabel } from "./hr-payroll/payroll-period-utils";
import type { fetchBudgetVsActualReportData } from "./reports/finance-report-data";
import {
  ALL_PROJECTS_FILTER,
  buildBudgetVsActualReport,
  resolveBudgetHealthStatus,
  sumBudgetVsActualTotals,
  type BudgetHealthStatus,
  type BudgetVsActualRow,
} from "./reports/budget-vs-actual-utils";
import { monthIndexFromMonthNumber } from "./reports/finance-reports-utils";

export type DashboardBudgetStatusRow = {
  label: string;
  budgeted: number;
  actual: number;
  remaining: number;
  status: BudgetHealthStatus;
  utilizationPercent: number | null;
  hasBudgetLines: boolean;
};

export type DashboardBudgetStatusSnapshot = {
  month: DashboardBudgetStatusRow;
  ytd: DashboardBudgetStatusRow;
};

export type BudgetVsActualReportData = Awaited<
  ReturnType<typeof fetchBudgetVsActualReportData>
>;

function budgetInYear(entry: BudgetRecord, year: number): boolean {
  const parts = getPeriodMonthParts(entry.period_month);
  return parts?.year === year;
}

function buildYtdThroughLabel(year: number, throughMonth: number): string {
  if (throughMonth <= 1) {
    return formatPeriodLabel(year, 1);
  }

  return `Jan – ${formatPeriodLabel(year, throughMonth)}`;
}

function monthHasBudgetLines(
  budgets: BudgetRecord[],
  year: number,
  month: number,
): boolean {
  const periodMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  const normalizedMonth = normalizePeriodMonth(periodMonth);
  const annualAnchor = buildAnnualPeriodMonth(year);

  return budgets.some((entry) => {
    if (isAnnualBudget(entry)) {
      return (
        normalizePeriodMonth(entry.period_month) === annualAnchor &&
        budgetInYear(entry, year)
      );
    }

    return normalizePeriodMonth(entry.period_month) === normalizedMonth;
  });
}

function ytdHasBudgetLines(
  budgets: BudgetRecord[],
  year: number,
  throughMonth: number,
): boolean {
  const annualAnchor = buildAnnualPeriodMonth(year);

  return budgets.some((entry) => {
    if (isAnnualBudget(entry)) {
      return (
        normalizePeriodMonth(entry.period_month) === annualAnchor &&
        budgetInYear(entry, year)
      );
    }

    const parts = getPeriodMonthParts(entry.period_month);
    return parts?.year === year && parts.month <= throughMonth;
  });
}

function buildBudgetStatusRowFromReport(
  report: BudgetVsActualRow[],
  label: string,
  hasBudgetLines: boolean,
): DashboardBudgetStatusRow {
  const totals = sumBudgetVsActualTotals(report);
  const utilizationPercent =
    totals.budgeted > 0
      ? Math.round((totals.actual / totals.budgeted) * 10000) / 100
      : null;

  return {
    label,
    budgeted: totals.budgeted,
    actual: totals.actual,
    remaining: totals.remaining,
    status: resolveBudgetHealthStatus(totals.budgeted, totals.actual),
    utilizationPercent,
    hasBudgetLines,
  };
}

export function buildDashboardBudgetStatusSnapshot(
  reportData: BudgetVsActualReportData,
  year: number,
  month: number,
  periodLabel: string,
): DashboardBudgetStatusSnapshot {
  const monthIndex = monthIndexFromMonthNumber(month);
  const sharedParams = {
    budgets: reportData.initialBudgets,
    expenses: reportData.initialExpenses,
    rawMaterialPurchases: reportData.initialRawMaterialPurchases,
    productPurchases: reportData.initialProductPurchases,
    payrollRows: reportData.initialPayrollRows,
    projects: reportData.initialProjects,
    year,
    month,
    monthIndex,
    projectFilter: ALL_PROJECTS_FILTER,
  };

  const monthReport = buildBudgetVsActualReport({
    ...sharedParams,
    viewMode: "monthly-prorated",
  });
  const ytdReport = buildBudgetVsActualReport({
    ...sharedParams,
    viewMode: "monthly-ytd",
  });

  return {
    month: buildBudgetStatusRowFromReport(
      monthReport,
      `Month (${periodLabel})`,
      monthHasBudgetLines(reportData.initialBudgets, year, month),
    ),
    ytd: buildBudgetStatusRowFromReport(
      ytdReport,
      `YTD (${buildYtdThroughLabel(year, month)})`,
      ytdHasBudgetLines(reportData.initialBudgets, year, month),
    ),
  };
}

export function buildDashboardBudgetStatusByMonthKey(
  reportData: BudgetVsActualReportData,
  monthOptions: Array<{
    key: string;
    year: number;
    month: number;
    label: string;
  }>,
): Record<string, DashboardBudgetStatusSnapshot> {
  const snapshots: Record<string, DashboardBudgetStatusSnapshot> = {};

  for (const option of monthOptions) {
    snapshots[option.key] = buildDashboardBudgetStatusSnapshot(
      reportData,
      option.year,
      option.month,
      option.label,
    );
  }

  return snapshots;
}

export function budgetUtilizationTextClassName(
  status: BudgetHealthStatus,
): string {
  switch (status) {
    case "green":
      return "text-emerald-700";
    case "amber":
      return "text-amber-800";
    case "red":
      return "text-red-700";
  }
}
