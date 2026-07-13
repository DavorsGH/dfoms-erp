import { formatGHS } from "./income-register-utils";
import {
  FULL_YEAR_INDEX,
  createEmptyMonthlyTotals,
  type MonthlyTotals,
} from "./profit-loss-utils";

export type CapitalContributionEntry = {
  id: string;
  date: string;
  contributed_by: string;
  amount: number;
  description: string | null;
  notes: string | null;
  employees?: { full_name: string } | { full_name: string }[] | null;
};

export function getContributorName(entry: CapitalContributionEntry): string {
  const employee = Array.isArray(entry.employees)
    ? entry.employees[0]
    : entry.employees;

  return employee?.full_name ?? entry.contributed_by;
}

export function formatContributionDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export { formatGHS };

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

export function getMonthEndDate(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function calculateShareCapitalAsOf(
  contributions: CapitalContributionEntry[],
  asOfDate: string,
): number {
  const cutoff = normalizeDate(asOfDate);

  return contributions.reduce((total, entry) => {
    const entryDate = normalizeDate(entry.date);
    if (!entryDate || entryDate > cutoff) {
      return total;
    }

    return total + (Number(entry.amount) || 0);
  }, 0);
}

export function calculateShareCapitalByMonth(
  contributions: CapitalContributionEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);
    totals[month - 1] = calculateShareCapitalAsOf(contributions, monthEnd);
  }

  totals[FULL_YEAR_INDEX] = calculateShareCapitalAsOf(
    contributions,
    getMonthEndDate(financialYear, 12),
  );

  return totals;
}
