/**
 * Canonical cash-movement engine for Balance Sheet cash and Cash Flow Statement.
 *
 * Known v1 gap (documented, out of scope): accounts_payable settlements do not
 * automatically move cash — paying AP only updates the AP register unless a
 * separate Paid expense_register row is entered.
 */
import {
  type CapitalContributionEntry,
} from "./capital-contributions-utils";
import {
  isCashOutflowExpense,
  type BalanceSheetCashExpenseEntry,
} from "./accrued-wages-utils";
import { calculateFixedAssetPurchaseOutflowsByMonth } from "./fixed-assets-utils";
import { isActiveIncomeForReporting } from "./income-register-utils";
import {
  addAmountToMonth,
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  getEntryMonthIndex,
  type MonthlyTotals,
  type ProfitLossAssetEntry,
} from "./profit-loss-utils";
import {
  calculateProductPurchaseCashOutflowsByMonth,
  calculateRawMaterialPurchaseCashOutflowsByMonth,
  type InventoryBalanceConfig,
  type ProductPurchaseCashEntry,
  type RawMaterialPurchaseCashEntry,
} from "../inventory/inventory-balance-sheet-utils";

function buildPeriodMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function getPeriodMonthParts(
  periodMonth: string,
): { year: number; month: number } | null {
  const datePart = periodMonth.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export type CashMovementIncomeEntry = {
  date?: string | null;
  amount_received: number;
  entry_type?: string | null;
  sale_status?: string | null;
};

export type CashMovementManualEntry = {
  period_month: string;
  loan_proceeds?: number | null;
  loan_repayments?: number | null;
  other_cash_inflows?: number | null;
  opening_cash_balance?: number | null;
};

export type CashMovementInputs = {
  incomeEntries: CashMovementIncomeEntry[];
  expenseEntries: BalanceSheetCashExpenseEntry[];
  capitalContributions: CapitalContributionEntry[];
  fixedAssets: ProfitLossAssetEntry[];
  rawMaterialCashPurchases: RawMaterialPurchaseCashEntry[];
  productCashPurchases: ProductPurchaseCashEntry[];
  inventoryConfig: InventoryBalanceConfig | null;
  manualEntries: CashMovementManualEntry[];
};

export type MonthlyCashComponents = {
  incomeReceived: MonthlyTotals;
  capitalContributions: MonthlyTotals;
  loanProceeds: MonthlyTotals;
  otherCashInflows: MonthlyTotals;
  paidExpenses: MonthlyTotals;
  loanRepayments: MonthlyTotals;
  rawMaterialPurchases: MonthlyTotals;
  productPurchases: MonthlyTotals;
  fixedAssetPurchases: MonthlyTotals;
  /** Signed net movement per month (inflows − outflows). */
  netMovement: MonthlyTotals;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMonthlyTotals(totals: MonthlyTotals): MonthlyTotals {
  return totals.map((value) => roundCurrency(value));
}

function addMonthlyTotals(
  left: MonthlyTotals,
  right: MonthlyTotals,
): MonthlyTotals {
  return left.map((value, index) =>
    roundCurrency(value + (right[index] ?? 0)),
  );
}

function subtractMonthlyTotals(
  minuend: MonthlyTotals,
  subtrahend: MonthlyTotals,
): MonthlyTotals {
  return minuend.map((value, index) =>
    roundCurrency(value - (subtrahend[index] ?? 0)),
  );
}

function manualFieldToMonthlyTotals(
  entries: CashMovementManualEntry[],
  field: keyof Pick<
    CashMovementManualEntry,
    "loan_proceeds" | "loan_repayments" | "other_cash_inflows"
  >,
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (const entry of entries) {
    const parts = getPeriodMonthParts(entry.period_month);
    if (!parts || parts.year !== financialYear) {
      continue;
    }

    const monthIndex = parts.month - 1;
    const amount = Number(entry[field]) || 0;
    totals[monthIndex] = amount;
    totals[FULL_YEAR_INDEX] += amount;
  }

  return roundMonthlyTotals(totals);
}

function sumIncomeReceivedByMonth(
  incomeEntries: CashMovementIncomeEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (const entry of incomeEntries) {
    if (!isActiveIncomeForReporting(entry)) {
      continue;
    }

    const monthIndex = getEntryMonthIndex(entry.date ?? null, financialYear);
    if (monthIndex === null) {
      continue;
    }

    addAmountToMonth(totals, monthIndex, Number(entry.amount_received) || 0);
  }

  return roundMonthlyTotals(totals);
}

function sumCapitalContributionsByMonth(
  contributions: CapitalContributionEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (const entry of contributions) {
    const monthIndex = getEntryMonthIndex(entry.date, financialYear);
    if (monthIndex === null) {
      continue;
    }

    addAmountToMonth(totals, monthIndex, Number(entry.amount) || 0);
  }

  return roundMonthlyTotals(totals);
}

function sumPaidExpensesByMonth(
  expenseEntries: BalanceSheetCashExpenseEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (const entry of expenseEntries) {
    if (!isCashOutflowExpense(entry)) {
      continue;
    }

    const monthIndex = getEntryMonthIndex(entry.date, financialYear);
    if (monthIndex === null) {
      continue;
    }

    addAmountToMonth(totals, monthIndex, Number(entry.amount) || 0);
  }

  return roundMonthlyTotals(totals);
}

/** January opening cash seed for the financial year (Option A). Default 0. */
export function resolveJanuaryOpeningCashBalance(
  manualEntries: CashMovementManualEntry[],
  financialYear: number,
): number {
  const januaryPeriod = buildPeriodMonth(financialYear, 1);
  const row = manualEntries.find(
    (entry) => entry.period_month.slice(0, 10) === januaryPeriod,
  );
  return Number(row?.opening_cash_balance) || 0;
}

/**
 * Pure monthly cash components + signed net movement for one financial year.
 */
export function buildMonthlyCashComponents(
  inputs: CashMovementInputs,
  financialYear: number,
): MonthlyCashComponents {
  const incomeReceived = sumIncomeReceivedByMonth(
    inputs.incomeEntries,
    financialYear,
  );
  const capitalContributions = sumCapitalContributionsByMonth(
    inputs.capitalContributions,
    financialYear,
  );
  const loanProceeds = manualFieldToMonthlyTotals(
    inputs.manualEntries,
    "loan_proceeds",
    financialYear,
  );
  const otherCashInflows = manualFieldToMonthlyTotals(
    inputs.manualEntries,
    "other_cash_inflows",
    financialYear,
  );
  const paidExpenses = sumPaidExpensesByMonth(
    inputs.expenseEntries,
    financialYear,
  );
  const loanRepayments = manualFieldToMonthlyTotals(
    inputs.manualEntries,
    "loan_repayments",
    financialYear,
  );
  const rawMaterialPurchases = roundMonthlyTotals(
    calculateRawMaterialPurchaseCashOutflowsByMonth(
      inputs.rawMaterialCashPurchases,
      inputs.inventoryConfig,
      financialYear,
    ),
  );
  const productPurchases = roundMonthlyTotals(
    calculateProductPurchaseCashOutflowsByMonth(
      inputs.productCashPurchases,
      inputs.inventoryConfig,
      financialYear,
    ),
  );
  const fixedAssetPurchases = roundMonthlyTotals(
    calculateFixedAssetPurchaseOutflowsByMonth(
      inputs.fixedAssets,
      financialYear,
    ),
  );

  const totalInflows = addMonthlyTotals(
    addMonthlyTotals(
      addMonthlyTotals(incomeReceived, capitalContributions),
      loanProceeds,
    ),
    otherCashInflows,
  );
  const totalOutflows = addMonthlyTotals(
    addMonthlyTotals(
      addMonthlyTotals(
        addMonthlyTotals(paidExpenses, loanRepayments),
        rawMaterialPurchases,
      ),
      productPurchases,
    ),
    fixedAssetPurchases,
  );
  const netMovement = subtractMonthlyTotals(totalInflows, totalOutflows);

  return {
    incomeReceived,
    capitalContributions,
    loanProceeds,
    otherCashInflows,
    paidExpenses,
    loanRepayments,
    rawMaterialPurchases,
    productPurchases,
    fixedAssetPurchases,
    netMovement,
  };
}

/**
 * Running closing cash for the year.
 * closing[0] = openingBalance + net[0]
 * closing[i] = closing[i-1] + net[i]
 * fullYear index = December closing
 */
export function buildClosingCashByMonth(
  netMovement: MonthlyTotals,
  openingBalance: number,
): MonthlyTotals {
  const closing = createEmptyMonthlyTotals();
  let running = roundCurrency(openingBalance);

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    running = roundCurrency(running + (netMovement[monthIndex] ?? 0));
    closing[monthIndex] = running;
  }

  closing[FULL_YEAR_INDEX] = closing[11];
  return closing;
}

/** Opening balance display series: January seed only; later months = prior closing. */
export function buildOpeningCashDisplayByMonth(
  closingCash: MonthlyTotals,
  januaryOpening: number,
): MonthlyTotals {
  const opening = createEmptyMonthlyTotals();
  opening[0] = roundCurrency(januaryOpening);
  for (let monthIndex = 1; monthIndex < 12; monthIndex += 1) {
    opening[monthIndex] = closingCash[monthIndex - 1] ?? 0;
  }
  opening[FULL_YEAR_INDEX] = opening[0];
  return opening;
}
