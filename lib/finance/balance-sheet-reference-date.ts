import { getMonthEndDate } from "@/app/dashboard/finance/capital-contributions-utils";
import {
  FULL_YEAR_INDEX,
  getEntryMonthIndex,
  type MonthlyTotals,
} from "@/app/dashboard/finance/profit-loss-utils";

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

export function normalizeBalanceSheetReferenceDate(referenceDate: Date): string {
  return normalizeDate(referenceDate.toISOString());
}

export function getBalanceSheetReferenceMonthIndex(
  referenceDate: Date,
  financialYear: number,
): number | null {
  return getEntryMonthIndex(
    normalizeBalanceSheetReferenceDate(referenceDate),
    financialYear,
  );
}

/** True when referenceDate is on or after the calendar month-end (full month). */
export function isBalanceSheetReferenceMonthComplete(
  referenceDate: Date,
  financialYear: number,
  monthIndex: number,
): boolean {
  const monthEnd = getMonthEndDate(financialYear, monthIndex + 1);
  const ref = normalizeBalanceSheetReferenceDate(referenceDate);
  return ref >= monthEnd;
}

/**
 * As-of date for a BS column: prior months use month-end; reference month uses
 * referenceDate when mid-month; later months use referenceDate (carry snapshot).
 */
export function balanceSheetAsOfDateForMonthColumn(
  monthIndex: number,
  financialYear: number,
  referenceDate?: Date,
): string {
  const monthEnd = getMonthEndDate(financialYear, monthIndex + 1);
  if (!referenceDate) {
    return monthEnd;
  }
  const ref = normalizeBalanceSheetReferenceDate(referenceDate);
  const refMonth = getEntryMonthIndex(ref, financialYear);
  if (refMonth === null) {
    return monthEnd;
  }
  if (monthIndex < refMonth) {
    return monthEnd;
  }
  if (monthIndex > refMonth) {
    return ref;
  }
  return ref < monthEnd ? ref : monthEnd;
}

/**
 * Month index for bucketing cash/P&L flows into the BS current-month column.
 * Returns null when the entry is after the reference cut-off in the reference month.
 */
export function resolveBalanceSheetEntryMonthIndex(
  entryDate: string | null | undefined,
  financialYear: number,
  referenceDate?: Date,
): number | null {
  if (!entryDate) {
    return null;
  }
  const datePart = entryDate.slice(0, 10);
  const monthIndex = getEntryMonthIndex(datePart, financialYear);
  if (monthIndex === null) {
    return null;
  }
  if (!referenceDate) {
    return monthIndex;
  }
  const ref = normalizeBalanceSheetReferenceDate(referenceDate);
  const refMonth = getEntryMonthIndex(ref, financialYear);
  if (refMonth === null) {
    return monthIndex;
  }
  if (monthIndex < refMonth) {
    return monthIndex;
  }
  if (monthIndex > refMonth) {
    return null;
  }
  if (isBalanceSheetReferenceMonthComplete(referenceDate, financialYear, monthIndex)) {
    return monthIndex;
  }
  return datePart <= ref ? monthIndex : null;
}

/** After mid-month ref, project later FY months to the reference-month closing value. */
export function projectBalanceSheetMonthlyTotalsAfterReference(
  totals: MonthlyTotals,
  referenceDate: Date | undefined,
  financialYear: number,
): MonthlyTotals {
  if (!referenceDate) {
    return totals;
  }
  const refMonth = getBalanceSheetReferenceMonthIndex(referenceDate, financialYear);
  if (refMonth === null) {
    return totals;
  }
  if (isBalanceSheetReferenceMonthComplete(referenceDate, financialYear, refMonth)) {
    return totals;
  }
  const out = [...totals] as MonthlyTotals;
  const carry = out[refMonth] ?? 0;
  for (let mi = refMonth + 1; mi < 12; mi += 1) {
    out[mi] = carry;
  }
  out[FULL_YEAR_INDEX] = out[11];
  return out;
}
