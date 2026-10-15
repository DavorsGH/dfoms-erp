const ACCRA_TIME_ZONE = "Africa/Accra";

/** Calendar month in Africa/Accra (tenant reporting timezone). */
export function todayAccraCalendarMonth(reference = new Date()): {
  year: number;
  month: number;
} {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: ACCRA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reference);
  const [year, month] = iso.split("-").map(Number);
  return { year, month };
}

/**
 * When the user names a month without a year, use the most recent occurrence
 * of that calendar month on or before today (Accra). E.g. in October 2026,
 * September → 2026, November → 2025.
 */
export function resolveYearForMonthNumber(
  month: number,
  reference = new Date(),
): number {
  const { year, month: currentMonth } = todayAccraCalendarMonth(reference);
  if (month <= currentMonth) {
    return year;
  }
  return year - 1;
}

export function parseAssistantYearMonth(
  toolInput: unknown,
  reference = new Date(),
): { year: number; month: number; yearExplicit: boolean } {
  const { year: defaultYear, month: defaultMonth } =
    todayAccraCalendarMonth(reference);

  if (!toolInput || typeof toolInput !== "object") {
    return {
      year: defaultYear,
      month: defaultMonth,
      yearExplicit: false,
    };
  }

  const input = toolInput as Record<string, unknown>;
  let month = defaultMonth;
  if (typeof input.month === "number" && Number.isFinite(input.month)) {
    month = Math.min(Math.max(Math.trunc(input.month), 1), 12);
  }

  const yearExplicit =
    typeof input.year === "number" && Number.isFinite(input.year);
  const year = yearExplicit
    ? Math.trunc(input.year as number)
    : resolveYearForMonthNumber(month, reference);

  return { year, month, yearExplicit };
}
