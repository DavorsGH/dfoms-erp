import { getMonthEndDate } from "@/app/dashboard/finance/capital-contributions-utils";
import {
  buildClosingCashByMonth,
  buildMonthlyCashComponents,
  resolveJanuaryOpeningCashBalance,
  type CashMovementInputs,
  type CashMovementManualEntry,
} from "@/app/dashboard/finance/cash-movement-utils";
import { MIN_FINANCE_YEAR } from "@/app/dashboard/finance/finance-year-utils";
import { inferFirstBookYearFromDates } from "@/lib/finance/balance-sheet-retained-earnings";

export { inferFirstBookYearFromDates };

/** January opening cash: manual seed in first book year; prior December closing thereafter. */
export function resolveJanuaryOpeningCashWithCarryForward(input: {
  manualEntries: CashMovementManualEntry[];
  financialYear: number;
  firstBookYear: number | null;
  cashMovementInputs: Omit<CashMovementInputs, "balanceSheetReferenceDate">;
  referenceDate?: Date;
}): number {
  const first = input.firstBookYear ?? input.financialYear;
  if (input.financialYear <= first) {
    return resolveJanuaryOpeningCashBalance(
      input.manualEntries,
      input.financialYear,
    );
  }

  let opening = resolveJanuaryOpeningCashBalance(input.manualEntries, first);
  for (let year = first; year < input.financialYear; year += 1) {
    const components = buildMonthlyCashComponents(
      {
        ...input.cashMovementInputs,
        balanceSheetReferenceDate: input.referenceDate,
      },
      year,
    );
    const closing = buildClosingCashByMonth(components.netMovement, opening);
    opening = closing[11] ?? opening;
  }

  return opening;
}

export function collectBalanceSheetActivityDates(input: {
  incomeDates?: Array<string | null | undefined>;
  expenseDates?: Array<string | null | undefined>;
  payableDates?: Array<string | null | undefined>;
  capitalContributionDates?: Array<string | null | undefined>;
  manualPeriodMonths?: Array<string | null | undefined>;
  fixedAssetPurchaseDates?: Array<string | null | undefined>;
  taxLedgerDates?: Array<string | null | undefined>;
  payrollMonths?: Array<string | null | undefined>;
  inventoryGoLiveDate?: string | null;
  inventoryPurchaseDates?: Array<string | null | undefined>;
}): string[] {
  const dates: string[] = [];
  if (input.inventoryGoLiveDate) {
    dates.push(input.inventoryGoLiveDate.slice(0, 10));
  }
  for (const list of [
    input.incomeDates,
    input.expenseDates,
    input.payableDates,
    input.capitalContributionDates,
    input.manualPeriodMonths,
    input.fixedAssetPurchaseDates,
    input.taxLedgerDates,
    input.payrollMonths,
    input.inventoryPurchaseDates,
  ]) {
    if (!list) continue;
    for (const d of list) {
      if (d) dates.push(d.slice(0, 10));
    }
  }
  return dates;
}

export function inferFirstBookYearForBalanceSheet(input: {
  incomeEntries: Array<{ date?: string | null }>;
  expenseEntries: Array<{ date?: string | null }>;
  payableEntries: Array<{ invoice_date?: string | null }>;
  capitalContributions: Array<{ date?: string | null }>;
  manualEntries: Array<{ period_month?: string | null }>;
  fixedAssets: Array<{ purchase_date?: string | null }>;
  taxLedgerEntries: Array<{ entry_date?: string | null }>;
  payrollHistory: Array<{ payroll_month?: string | null }>;
  inventoryGoLiveDate?: string | null;
  inventoryCashPurchases?: Array<{ purchase_date?: string | null }>;
  inventoryProductCashPurchases?: Array<{ purchase_date?: string | null }>;
}): number | null {
  const purchaseDates = [
    ...(input.inventoryCashPurchases ?? []).map((e) => e.purchase_date),
    ...(input.inventoryProductCashPurchases ?? []).map((e) => e.purchase_date),
  ];
  return inferFirstBookYearFromDates(
    collectBalanceSheetActivityDates({
      incomeDates: input.incomeEntries.map((e) => e.date),
      expenseDates: input.expenseEntries.map((e) => e.date),
      payableDates: input.payableEntries.map((e) => e.invoice_date),
      capitalContributionDates: input.capitalContributions.map((e) => e.date),
      manualPeriodMonths: input.manualEntries.map((e) => e.period_month),
      fixedAssetPurchaseDates: input.fixedAssets.map((e) => e.purchase_date),
      taxLedgerDates: input.taxLedgerEntries.map((e) => e.entry_date),
      payrollMonths: input.payrollHistory.map((e) => e.payroll_month),
      inventoryGoLiveDate: input.inventoryGoLiveDate,
      inventoryPurchaseDates: purchaseDates,
    }),
  );
}

/** Widen register fetch when viewing a FY that needs full P&L history (e.g. 2027+). */
export function getBalanceSheetFetchDateRangeForFinancialYear(
  financialYear: number,
  referenceDate = new Date(),
): { from: string; to: string } {
  const calendarYear = referenceDate.getFullYear();
  const defaultRange = {
    from: `${calendarYear - 1}-01-01`,
    to: `${calendarYear}-12-31`,
  };
  if (financialYear <= calendarYear) {
    return {
      from: defaultRange.from,
      to: `${Math.max(financialYear, calendarYear)}-12-31`,
    };
  }
  return {
    from: `${MIN_FINANCE_YEAR}-01-01`,
    to: `${financialYear}-12-31`,
  };
}

export function decemberMonthEndIso(financialYear: number): string {
  return getMonthEndDate(financialYear, 12);
}
