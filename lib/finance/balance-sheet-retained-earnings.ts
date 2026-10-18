import {
  calculateInventoryAdjustmentGainByMonth,
  calculateInventoryAdjustmentLossByMonth,
  filterStockAdjustmentsForPlOverlay,
  type InventoryStockAdjustmentRow,
} from "@/lib/inventory/inventory-stock-adjustment-financials";
import {
  buildProfitLossReport,
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  type MonthlyTotals,
  type ProfitLossAssetEntry,
  type ProfitLossExpenseEntry,
  type ProfitLossIncomeEntry,
} from "@/app/dashboard/finance/profit-loss-utils";
import {
  extractYearFromDate,
  MIN_FINANCE_YEAR,
} from "@/app/dashboard/finance/finance-year-utils";
import type { DividendBalanceSheetDeclaration } from "@/app/dashboard/finance/dividends-types";
import {
  calculateDeclaredDividendGrossReductionCumulativeByMonth,
  dividendGrossDeclaredThroughDate,
  type DividendBalanceSheetFilter,
} from "@/app/dashboard/finance/dividends-balance-sheet-utils";
import type { ManualFinancialEntryRecord } from "@/app/dashboard/finance/manual-financial-entries-utils";
import { getMonthEndDate } from "@/app/dashboard/finance/capital-contributions-utils";

function roundCurrency(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function inferFirstBookYearFromDates(
  dates: Array<string | null | undefined>,
): number | null {
  let min: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    const part = d.slice(0, 10);
    if (!min || part < min) min = part;
  }
  if (!min) return null;
  const y = extractYearFromDate(min);
  return y && y >= MIN_FINANCE_YEAR ? y : null;
}

export function sumManualRetainedEarningsPriorYears(
  manualEntries: ManualFinancialEntryRecord[],
  filter: DividendBalanceSheetFilter,
): number {
  let sum = 0;
  for (const row of manualEntries) {
    const v = Number(row.retained_earnings_prior_years) || 0;
    if (Math.abs(v) < 0.005) continue;
    const bu = row.business_unit_id ?? null;
    if (filter.mode === "none") continue;
    if (filter.mode === "unit" && bu !== filter.businessUnitId) continue;
    sum += v;
  }
  return roundCurrency(sum);
}

export function fullYearNetProfitPlusInventoryAdj(
  incomeEntries: ProfitLossIncomeEntry[],
  expenseEntries: ProfitLossExpenseEntry[],
  fixedAssets: ProfitLossAssetEntry[],
  stockAdjustments: InventoryStockAdjustmentRow[],
  goLiveDate: string | null,
  year: number,
): number {
  const report = buildProfitLossReport(
    incomeEntries,
    expenseEntries,
    fixedAssets,
    year,
  );
  const np = report.rows.find((row) => row.key === "net-profit");
  let total = np?.amounts[FULL_YEAR_INDEX] ?? 0;
  if (goLiveDate) {
    const gain = calculateInventoryAdjustmentGainByMonth(
      stockAdjustments,
      year,
      goLiveDate,
    );
    const loss = calculateInventoryAdjustmentLossByMonth(
      stockAdjustments,
      year,
      goLiveDate,
    );
    for (let i = 0; i < 12; i += 1) {
      total += (gain[i] ?? 0) - (loss[i] ?? 0);
    }
  }
  return roundCurrency(total);
}

function buildInventoryAdjustmentPlNetByMonth(
  stockAdjustments: InventoryStockAdjustmentRow[],
  linkedPlKeys: Set<string>,
  financialYear: number,
  goLiveDate: string | null,
  referenceDate?: Date,
): MonthlyTotals | null {
  if (!goLiveDate) {
    return null;
  }
  const filtered = filterStockAdjustmentsForPlOverlay(
    stockAdjustments,
    linkedPlKeys,
  );
  const gain = calculateInventoryAdjustmentGainByMonth(
    filtered,
    financialYear,
    goLiveDate,
    referenceDate,
  );
  const loss = calculateInventoryAdjustmentLossByMonth(
    filtered,
    financialYear,
    goLiveDate,
    referenceDate,
  );
  return gain.map((g, index) =>
    roundCurrency(g - (loss[index] ?? 0)),
  ) as MonthlyTotals;
}

/** Retained earnings at prior calendar year-end (opening for `financialYear`). */
export function calculateRetainedEarningsAtPriorYearEnd(input: {
  financialYear: number;
  firstBookYear: number | null;
  incomeEntries: ProfitLossIncomeEntry[];
  expenseEntries: ProfitLossExpenseEntry[];
  fixedAssets: ProfitLossAssetEntry[];
  stockAdjustments: InventoryStockAdjustmentRow[];
  stockAdjustmentRegisterLinkedPlKeys?: string[];
  goLiveDate: string | null;
  dividendDeclarations: DividendBalanceSheetDeclaration[];
  dividendFilter: DividendBalanceSheetFilter;
  manualEntries: ManualFinancialEntryRecord[];
  referenceDate?: Date;
}): number {
  const manual = sumManualRetainedEarningsPriorYears(
    input.manualEntries,
    input.dividendFilter,
  );
  const first = input.firstBookYear ?? input.financialYear;
  if (input.financialYear <= first) {
    return manual;
  }

  const linkedPlKeys = new Set(input.stockAdjustmentRegisterLinkedPlKeys ?? []);
  let opening = manual;
  for (let year = first; year < input.financialYear; year += 1) {
    const monthly = calculateRetainedEarningsByMonthWithCarryForward({
      financialYear: year,
      openingRetainedEarnings: opening,
      incomeEntries: input.incomeEntries,
      expenseEntries: input.expenseEntries,
      fixedAssets: input.fixedAssets,
      inventoryAdjustmentPlNetByMonth: buildInventoryAdjustmentPlNetByMonth(
        input.stockAdjustments,
        linkedPlKeys,
        year,
        input.goLiveDate,
        input.referenceDate,
      ),
      dividendDeclarations: input.dividendDeclarations,
      dividendFilter: input.dividendFilter,
      referenceDate: input.referenceDate,
    });
    opening = monthly[11] ?? opening;
  }
  return opening;
}

function sumInYearProfitThroughMonth(
  netProfitAmounts: number[],
  monthIndex: number,
  inventoryAdjustmentPlNetByMonth: MonthlyTotals | null,
): number {
  let sum = 0;
  for (let i = 0; i <= monthIndex; i += 1) {
    sum += (netProfitAmounts[i] ?? 0) + (inventoryAdjustmentPlNetByMonth?.[i] ?? 0);
  }
  return roundCurrency(sum);
}

export function calculateRetainedEarningsByMonthWithCarryForward(input: {
  financialYear: number;
  openingRetainedEarnings: number;
  incomeEntries: ProfitLossIncomeEntry[];
  expenseEntries: ProfitLossExpenseEntry[];
  fixedAssets: ProfitLossAssetEntry[];
  inventoryAdjustmentPlNetByMonth: MonthlyTotals | null;
  dividendDeclarations: DividendBalanceSheetDeclaration[];
  dividendFilter: DividendBalanceSheetFilter;
  referenceDate?: Date;
}): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  const report = buildProfitLossReport(
    input.incomeEntries,
    input.expenseEntries,
    input.fixedAssets,
    input.financialYear,
    input.referenceDate,
  );
  const netProfitRow = report.rows.find((row) => row.key === "net-profit");
  if (!netProfitRow) {
    return totals;
  }

  const priorYearEnd = getMonthEndDate(input.financialYear - 1, 12);
  const divThroughPriorYearEnd = dividendGrossDeclaredThroughDate(
    input.dividendDeclarations,
    priorYearEnd,
    input.dividendFilter,
  );

  const divCumulativeInYear = calculateDeclaredDividendGrossReductionCumulativeByMonth(
    input.dividendDeclarations,
    input.financialYear,
    input.dividendFilter,
  );

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const inYearProfit = sumInYearProfitThroughMonth(
      netProfitRow.amounts,
      monthIndex,
      input.inventoryAdjustmentPlNetByMonth,
    );
    const divThroughMonth = divCumulativeInYear[monthIndex] ?? 0;
    const divDeltaInYear = roundCurrency(divThroughMonth - divThroughPriorYearEnd);
    totals[monthIndex] = roundCurrency(
      input.openingRetainedEarnings + inYearProfit - divDeltaInYear,
    );
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}
