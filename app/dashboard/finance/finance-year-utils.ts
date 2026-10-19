import {
  buildReportYearOptions,
  getCurrentReportYear,
  resolveInitialReportYear,
} from "../reports/report-period-utils";

export const MIN_FINANCE_YEAR = 2024;

/** Upper bound for finance year pickers (current calendar year + 1). */
export function getMaxFinanceYear(): number {
  return getCurrentReportYear() + 1;
}

export function getCurrentFinancialYear(): number {
  return getCurrentReportYear();
}

export function extractYearFromDate(
  date: string | null | undefined,
): number | null {
  if (!date) {
    return null;
  }

  const match = /^(\d{4})-\d{2}-\d{2}/.exec(date.slice(0, 10));
  return match ? Number(match[1]) : null;
}

export function buildAvailableYears(
  incomeDates: Array<string | null | undefined>,
  expenseDates: Array<string | null | undefined>,
  additionalDates: Array<string | null | undefined> = [],
): number[] {
  const fromData: number[] = [];

  for (const date of [...incomeDates, ...expenseDates, ...additionalDates]) {
    const year = extractYearFromDate(date);
    if (year) {
      fromData.push(year);
    }
  }

  return buildReportYearOptions(fromData);
}

export function getDefaultSelectedYear(availableYears: number[]): number {
  return resolveInitialReportYear(availableYears);
}
