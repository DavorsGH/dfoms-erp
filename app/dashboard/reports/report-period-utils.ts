/**
 * Shared default period and year-dropdown helpers for reports and finance screens.
 * Calendar month/year uses UTC (Ghana — Africa/Accra has no DST).
 */

export const REPORT_YEAR_QUERY_MIN = 1900;
export const REPORT_YEAR_QUERY_MAX = 2100;

/** @deprecated Prefer getDefaultReportPeriod */
export function getDefaultReportMonthYear(): { year: number; month: number } {
  return getDefaultReportPeriod();
}

export function getDefaultReportPeriod(): { year: number; month: number } {
  const now = new Date();
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  };
}

export function getCurrentReportYear(): number {
  return getDefaultReportPeriod().year;
}

export function parseReportYearQueryParam(
  raw: string | null | undefined,
): number | undefined {
  if (raw == null || raw.trim() === "") {
    return undefined;
  }
  const year = Number(raw);
  if (
    !Number.isInteger(year) ||
    year < REPORT_YEAR_QUERY_MIN ||
    year > REPORT_YEAR_QUERY_MAX
  ) {
    return undefined;
  }
  return year;
}

export function parseReportMonthQueryParam(
  raw: string | null | undefined,
): number | undefined {
  if (raw == null || raw.trim() === "") {
    return undefined;
  }
  const month = Number(raw);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return undefined;
  }
  return month;
}

/**
 * Pick initial year: preferred (URL or current) when listed, else closest year in options.
 */
export function resolveInitialReportYear(
  availableYears: number[],
  preferredYear?: number,
): number {
  const { year: currentYear } = getDefaultReportPeriod();
  const preferred = preferredYear ?? currentYear;

  if (availableYears.includes(preferred)) {
    return preferred;
  }

  if (availableYears.length === 0) {
    return preferred;
  }

  return availableYears.reduce((closest, candidate) =>
    Math.abs(candidate - preferred) < Math.abs(closest - preferred)
      ? candidate
      : closest,
  );
}

/**
 * Year dropdown: earliest year in tenant data, or (current − 5), through current + 1.
 */
export function buildReportYearOptions(
  dataYears: Iterable<number> = [],
): number[] {
  const currentYear = getCurrentReportYear();
  const fallbackStart = currentYear - 5;
  let earliestData: number | null = null;

  for (const year of dataYears) {
    if (!Number.isFinite(year) || year < REPORT_YEAR_QUERY_MIN) {
      continue;
    }
    earliestData =
      earliestData === null ? year : Math.min(earliestData, year);
  }

  let startYear = earliestData ?? fallbackStart;
  const endYear = currentYear + 1;

  if (startYear > endYear) {
    startYear = fallbackStart;
  }

  const years: number[] = [];
  for (let year = startYear; year <= endYear; year += 1) {
    years.push(year);
  }

  return years.sort((left, right) => right - left);
}
