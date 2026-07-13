export const MIN_FINANCE_YEAR = 2024;
export const MAX_FINANCE_YEAR = 2035;

export function getCurrentFinancialYear(): number {
  return new Date().getFullYear();
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
  const years = new Set<number>();

  for (let year = MIN_FINANCE_YEAR; year <= MAX_FINANCE_YEAR; year += 1) {
    years.add(year);
  }

  years.add(getCurrentFinancialYear());

  for (const date of [...incomeDates, ...expenseDates, ...additionalDates]) {
    const year = extractYearFromDate(date);
    if (year) {
      years.add(year);
    }
  }

  return Array.from(years)
    .filter((year) => year >= MIN_FINANCE_YEAR && year <= MAX_FINANCE_YEAR)
    .sort((left, right) => right - left);
}

export function getDefaultSelectedYear(availableYears: number[]): number {
  const currentYear = getCurrentFinancialYear();

  if (availableYears.includes(currentYear)) {
    return currentYear;
  }

  return availableYears[0] ?? currentYear;
}
