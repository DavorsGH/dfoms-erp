import { getMonthEndDate } from "./capital-contributions-utils";
import {
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  type MonthlyTotals,
} from "./profit-loss-utils";
import type {
  DividendBalanceSheetDeclaration,
  DividendBalanceSheetLine,
  DividendDeclarationStatus,
} from "./dividends-types";

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

const ACTIVE_DECLARATION_STATUSES: DividendDeclarationStatus[] = [
  "declared",
  "paid",
];

/** All businesses | single BU | Untagged (no dividend rows — declarations always have a BU). */
export type DividendBalanceSheetFilter =
  | { mode: "all" }
  | { mode: "none" }
  | { mode: "unit"; businessUnitId: string };

export function resolveDividendBalanceSheetFilter(input: {
  dividendBalanceSheetFilter?: DividendBalanceSheetFilter;
  balanceSheetBusinessUnitId?: string | null;
}): DividendBalanceSheetFilter {
  if (input.dividendBalanceSheetFilter) {
    return input.dividendBalanceSheetFilter;
  }
  const legacyId = input.balanceSheetBusinessUnitId;
  if (legacyId) {
    return { mode: "unit", businessUnitId: legacyId };
  }
  return { mode: "all" };
}

function declarationMatchesFilter(
  declarationBusinessUnitId: string | null | undefined,
  filter: DividendBalanceSheetFilter,
): boolean {
  if (filter.mode === "none") {
    return false;
  }
  if (filter.mode === "all") {
    return true;
  }
  return declarationBusinessUnitId === filter.businessUnitId;
}

function declarationsDeclaredInMonth(
  declarations: DividendBalanceSheetDeclaration[],
  financialYear: number,
  month: number,
  filter: DividendBalanceSheetFilter,
): DividendBalanceSheetDeclaration[] {
  return declarations.filter((row) => {
    if (!ACTIVE_DECLARATION_STATUSES.includes(row.status)) {
      return false;
    }
    if (!declarationMatchesFilter(row.business_unit_id, filter)) {
      return false;
    }
    const declDate = normalizeDate(row.declaration_date);
    const year = Number(declDate.slice(0, 4));
    const declMonth = Number(declDate.slice(5, 7));
    return year === financialYear && declMonth === month;
  });
}

function declarationsThroughMonthEnd(
  declarations: DividendBalanceSheetDeclaration[],
  financialYear: number,
  month: number,
  filter: DividendBalanceSheetFilter,
): DividendBalanceSheetDeclaration[] {
  const monthEnd = getMonthEndDate(financialYear, month);
  return declarations.filter((row) => {
    if (!ACTIVE_DECLARATION_STATUSES.includes(row.status)) {
      return false;
    }
    if (!declarationMatchesFilter(row.business_unit_id, filter)) {
      return false;
    }
    const declDate = normalizeDate(row.declaration_date);
    return declDate <= monthEnd;
  });
}

/** Cumulative declared gross reduces retained earnings (no P&L expense). */
export function calculateDeclaredDividendGrossReductionByMonth(
  declarations: DividendBalanceSheetDeclaration[],
  financialYear: number,
  filter: DividendBalanceSheetFilter = { mode: "all" },
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  let cumulative = 0;

  for (let month = 1; month <= 12; month += 1) {
    const monthGross = declarationsDeclaredInMonth(
      declarations,
      financialYear,
      month,
      filter,
    ).reduce((sum, row) => sum + (Number(row.gross_amount) || 0), 0);

    cumulative = roundCurrency(cumulative + monthGross);
    totals[month - 1] = cumulative;
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

/** Net declared minus line payments (by payment_date). */
export function calculateDividendsPayableByMonth(
  declarations: DividendBalanceSheetDeclaration[],
  lines: DividendBalanceSheetLine[],
  financialYear: number,
  filter: DividendBalanceSheetFilter = { mode: "all" },
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);
    let liability = 0;

    for (const decl of declarationsThroughMonthEnd(
      declarations,
      financialYear,
      month,
      filter,
    )) {
      liability += Number(decl.net_amount) || 0;
      const declLines = lines.filter((line) => line.declaration_id === decl.id);
      for (const line of declLines) {
        const payDate = line.payment_date
          ? normalizeDate(line.payment_date)
          : null;
        if (payDate && payDate <= monthEnd) {
          liability -= Number(line.paid_amount) || 0;
        }
      }
    }

    totals[month - 1] = roundCurrency(Math.max(0, liability));
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

export function calculateDividendCashOutflowsByMonth(
  lines: DividendBalanceSheetLine[],
  declarations: DividendBalanceSheetDeclaration[],
  financialYear: number,
  filter: DividendBalanceSheetFilter = { mode: "all" },
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  const declById = new Map(declarations.map((row) => [row.id, row]));

  for (const line of lines) {
    if (!line.payment_date) {
      continue;
    }
    const decl = declById.get(line.declaration_id);
    if (!decl || decl.status === "cancelled" || decl.status === "draft") {
      continue;
    }
    if (!declarationMatchesFilter(decl.business_unit_id, filter)) {
      continue;
    }
    const monthIndex = (() => {
      const date = normalizeDate(line.payment_date!);
      const year = Number(date.slice(0, 4));
      const month = Number(date.slice(5, 7));
      if (year !== financialYear || month < 1 || month > 12) {
        return null;
      }
      return month - 1;
    })();
    if (monthIndex === null) {
      continue;
    }
    totals[monthIndex] = roundCurrency(
      totals[monthIndex] + (Number(line.paid_amount) || 0),
    );
    totals[FULL_YEAR_INDEX] += Number(line.paid_amount) || 0;
  }

  totals[FULL_YEAR_INDEX] = roundCurrency(totals[FULL_YEAR_INDEX]);
  return totals;
}

export function sumDeclaredGrossInQuarter(input: {
  declarations: DividendBalanceSheetDeclaration[];
  businessUnitId: string;
  year: number;
  quarterStartMonth: number;
  throughMonth: number;
}): number {
  const start = `${input.year}-${String(input.quarterStartMonth).padStart(2, "0")}-01`;
  const end = getMonthEndDate(input.year, input.throughMonth);
  let total = 0;
  for (const row of input.declarations) {
    if (row.business_unit_id !== input.businessUnitId) {
      continue;
    }
    if (!ACTIVE_DECLARATION_STATUSES.includes(row.status)) {
      continue;
    }
    const d = normalizeDate(row.declaration_date);
    if (d >= start.slice(0, 10) && d <= end) {
      total += Number(row.gross_amount) || 0;
    }
  }
  return roundCurrency(total);
}
