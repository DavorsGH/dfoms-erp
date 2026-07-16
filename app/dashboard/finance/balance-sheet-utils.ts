import {
  calculateShareCapitalByMonth,
  getMonthEndDate,
  type CapitalContributionEntry,
} from "./capital-contributions-utils";
import {
  calculateTotalCost,
  calculateMonthlyNetBookValueTotals,
} from "./fixed-assets-utils";
import {
  calculateAccruedWagesPayableByMonth,
  isCashOutflowExpense,
  type BalanceSheetCashExpenseEntry,
  type MonthEndCloseNetPayEntry,
  type PayrollHistoryWagesEntry,
} from "./accrued-wages-utils";
import {
  addAmountToMonth,
  buildProfitLossReport,
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  getEntryMonthIndex,
  sumMonthlyTotals,
  type MonthlyTotals,
  type ProfitLossAssetEntry,
  type ProfitLossExpenseEntry,
  type ProfitLossIncomeEntry,
} from "./profit-loss-utils";
import { getCurrentFinancialYear } from "./finance-year-utils";
import { isActiveIncomeForReporting } from "./income-register-utils";
import {
  calculateInventoryByMonth,
  calculateInventoryOpeningEquityByMonth,
  calculateRawMaterialPurchaseCashOutflowsByMonth,
  type InventoryBalanceConfig,
  type RawMaterialPurchaseCashEntry,
} from "../inventory/inventory-balance-sheet-utils";
import type { ProductionBatchCostSummary } from "../reports/inventory-reports-utils";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";
import type { RawMaterialRecord } from "../inventory/raw-materials-utils";

export { MONTH_LABELS, FULL_YEAR_INDEX } from "./profit-loss-utils";

export const BALANCE_TOLERANCE = 0.01;

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMonthlyTotals(totals: MonthlyTotals): MonthlyTotals {
  return totals.map((value) => roundCurrency(value));
}

export type BalanceSheetAccountsPayableEntry = {
  invoice_date: string;
  balance_due: number | null;
  amount: number;
  amount_paid: number;
};

export type BalanceSheetIncomeEntry = {
  date: string;
  amount: number;
  amount_received: number;
  outstanding_balance: number | null;
  service_category: string;
  entry_type?: "service" | "product_sale" | null;
  sale_status?: "active" | "voided" | null;
};

export type BalanceSheetRow = {
  key: string;
  label: string;
  amounts: MonthlyTotals;
  kind: "section" | "data" | "subtotal" | "total";
  side?: "assets" | "liabilities" | "equity" | "combined";
};

export type InventoryBalanceSheetInput = {
  config: InventoryBalanceConfig | null;
  rawMaterials: Array<
    Pick<
      RawMaterialRecord,
      "current_stock" | "average_cost_per_unit" | "reorder_level"
    >
  >;
  finishedProducts: Array<Pick<FinishedProductRecord, "id" | "current_stock">>;
  batchSummaries: ProductionBatchCostSummary[];
  cashPurchases: RawMaterialPurchaseCashEntry[];
  referenceDate?: Date;
};

export type BalanceSheetReport = {
  financialYear: number;
  rows: BalanceSheetRow[];
  totalAssets: MonthlyTotals;
  totalLiabilities: MonthlyTotals;
  totalEquity: MonthlyTotals;
  totalLiabilitiesAndEquity: MonthlyTotals;
};

export type BalanceSheetMonthRow = {
  key: string;
  label: string;
  amount: number;
  kind: BalanceSheetRow["kind"];
};

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

function getOutstandingBalance(entry: BalanceSheetIncomeEntry): number {
  if (entry.outstanding_balance !== null && entry.outstanding_balance !== undefined) {
    return Number(entry.outstanding_balance) || 0;
  }

  return Math.max(
    (Number(entry.amount) || 0) - (Number(entry.amount_received) || 0),
    0,
  );
}

function getPayableBalance(entry: BalanceSheetAccountsPayableEntry): number {
  if (entry.balance_due !== null && entry.balance_due !== undefined) {
    return Math.max(Number(entry.balance_due) || 0, 0);
  }

  return Math.max((Number(entry.amount) || 0) - (Number(entry.amount_paid) || 0), 0);
}

function calculateAccountsReceivableByMonth(
  incomeEntries: BalanceSheetIncomeEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);

    totals[month - 1] = incomeEntries.reduce((sum, entry) => {
      if (!isActiveIncomeForReporting(entry)) {
        return sum;
      }

      const entryDate = normalizeDate(entry.date);
      if (!entryDate || entryDate > monthEnd) {
        return sum;
      }

      return sum + getOutstandingBalance(entry);
    }, 0);
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

function calculateAccountsPayableByMonth(
  payableEntries: BalanceSheetAccountsPayableEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);

    totals[month - 1] = payableEntries.reduce((sum, entry) => {
      const entryDate = normalizeDate(entry.invoice_date);
      if (!entryDate || entryDate > monthEnd) {
        return sum;
      }

      return sum + getPayableBalance(entry);
    }, 0);
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

function calculateFixedAssetsNetByMonth(
  fixedAssets: ProfitLossAssetEntry[],
  financialYear: number,
): MonthlyTotals {
  return calculateMonthlyNetBookValueTotals(fixedAssets, financialYear);
}

function calculateRetainedEarningsByMonth(
  incomeEntries: ProfitLossIncomeEntry[],
  expenseEntries: ProfitLossExpenseEntry[],
  fixedAssets: ProfitLossAssetEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  const report = buildProfitLossReport(
    incomeEntries,
    expenseEntries,
    fixedAssets,
    financialYear,
  );
  const netProfitRow = report.rows.find((row) => row.key === "net-profit");

  if (!netProfitRow) {
    return totals;
  }

  let cumulative = 0;

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    cumulative += netProfitRow.amounts[monthIndex] ?? 0;
    totals[monthIndex] = cumulative;
  }

  totals[FULL_YEAR_INDEX] = cumulative;
  return totals;
}

function calculateCapitalContributionCashInflowsByMonth(
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

/** Mirrors cash-flow-utils sumCashReceivedByMonth: sum amount_received by invoice date month. */
function sumIncomeReceivedByMonth(
  incomeEntries: BalanceSheetIncomeEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (const entry of incomeEntries) {
    if (!isActiveIncomeForReporting(entry)) {
      continue;
    }

    const monthIndex = getEntryMonthIndex(entry.date, financialYear);
    if (monthIndex === null) {
      continue;
    }

    addAmountToMonth(totals, monthIndex, Number(entry.amount_received) || 0);
  }

  return roundMonthlyTotals(totals);
}

function calculateFixedAssetPurchaseOutflowsByMonth(
  fixedAssets: ProfitLossAssetEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (const asset of fixedAssets) {
    const monthIndex = getEntryMonthIndex(asset.purchase_date, financialYear);
    if (monthIndex === null) {
      continue;
    }

    const totalCost = calculateTotalCost(
      Number(asset.original_cost) || 0,
      Number(asset.quantity) || 0,
    );
    addAmountToMonth(totals, monthIndex, totalCost);
  }

  return roundMonthlyTotals(totals);
}

function calculatePaidExpensesByMonth(
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

function calculateCashAndCashEquivalentsByMonth(
  capitalContributions: CapitalContributionEntry[],
  incomeEntries: BalanceSheetIncomeEntry[],
  expenseEntries: BalanceSheetCashExpenseEntry[],
  fixedAssets: ProfitLossAssetEntry[],
  rawMaterialCashPurchases: RawMaterialPurchaseCashEntry[],
  inventoryConfig: InventoryBalanceConfig | null,
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  const contributionInflows = calculateCapitalContributionCashInflowsByMonth(
    capitalContributions,
    financialYear,
  );
  const incomeReceivedInflows = sumIncomeReceivedByMonth(
    incomeEntries,
    financialYear,
  );
  const paidExpenseOutflows = calculatePaidExpensesByMonth(
    expenseEntries,
    financialYear,
  );
  const fixedAssetPurchases = calculateFixedAssetPurchaseOutflowsByMonth(
    fixedAssets,
    financialYear,
  );
  const rawMaterialPurchases = calculateRawMaterialPurchaseCashOutflowsByMonth(
    rawMaterialCashPurchases,
    inventoryConfig,
    financialYear,
  );

  let runningBalance = 0;

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    runningBalance = roundCurrency(
      runningBalance +
        (contributionInflows[monthIndex] ?? 0) +
        (incomeReceivedInflows[monthIndex] ?? 0) -
        (paidExpenseOutflows[monthIndex] ?? 0) -
        (fixedAssetPurchases[monthIndex] ?? 0) -
        (rawMaterialPurchases[monthIndex] ?? 0),
    );
    totals[monthIndex] = runningBalance;
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

export function getBalanceSheetAmountForMonth(
  row: BalanceSheetRow,
  monthIndex: number,
): number {
  if (row.kind === "section") {
    return 0;
  }

  return roundCurrency(row.amounts[monthIndex] ?? 0);
}

export function getBalanceSheetForMonth(
  report: BalanceSheetReport,
  monthIndex: number,
): BalanceSheetMonthRow[] {
  return report.rows.map((row) => ({
    key: row.key,
    label: row.label,
    kind: row.kind,
    amount: getBalanceSheetAmountForMonth(row, monthIndex),
  }));
}

export function getBalanceCheckForPeriod(
  report: BalanceSheetReport,
  periodIndex = FULL_YEAR_INDEX,
) {
  const totalAssets = roundCurrency(report.totalAssets[periodIndex] ?? 0);
  const totalLiabilitiesAndEquity = roundCurrency(
    report.totalLiabilitiesAndEquity[periodIndex] ?? 0,
  );
  const difference = roundCurrency(totalAssets - totalLiabilitiesAndEquity);
  const isBalanced = Math.abs(difference) <= BALANCE_TOLERANCE;

  return {
    totalAssets,
    totalLiabilitiesAndEquity,
    difference,
    isBalanced,
  };
}

export function buildBalanceSheetReport(
  incomeEntries: BalanceSheetIncomeEntry[],
  expenseEntries: ProfitLossExpenseEntry[],
  fixedAssets: ProfitLossAssetEntry[],
  payableEntries: BalanceSheetAccountsPayableEntry[],
  capitalContributions: CapitalContributionEntry[],
  cashFlowExpenseEntries: BalanceSheetCashExpenseEntry[],
  payrollHistory: PayrollHistoryWagesEntry[],
  monthEndCloseNetPay: MonthEndCloseNetPayEntry[] = [],
  financialYear = getCurrentFinancialYear(),
  inventoryInput: InventoryBalanceSheetInput = {
    config: null,
    rawMaterials: [],
    finishedProducts: [],
    batchSummaries: [],
    cashPurchases: [],
  },
): BalanceSheetReport {
  const cash = calculateCashAndCashEquivalentsByMonth(
    capitalContributions,
    incomeEntries,
    cashFlowExpenseEntries,
    fixedAssets,
    inventoryInput.cashPurchases,
    inventoryInput.config,
    financialYear,
  );
  const accountsReceivable = roundMonthlyTotals(
    calculateAccountsReceivableByMonth(incomeEntries, financialYear),
  );
  const fixedAssetsNet = roundMonthlyTotals(
    calculateFixedAssetsNetByMonth(fixedAssets, financialYear),
  );
  const inventory = roundMonthlyTotals(
    calculateInventoryByMonth(
      inventoryInput.rawMaterials,
      inventoryInput.finishedProducts,
      inventoryInput.batchSummaries,
      inventoryInput.config,
      financialYear,
      inventoryInput.referenceDate,
    ),
  );
  const totalAssets = roundMonthlyTotals(
    sumMonthlyTotals([cash, accountsReceivable, fixedAssetsNet, inventory]),
  );

  const accountsPayable = roundMonthlyTotals(
    calculateAccountsPayableByMonth(payableEntries, financialYear),
  );
  const accruedWagesPayable = roundMonthlyTotals(
    calculateAccruedWagesPayableByMonth(
      payrollHistory,
      cashFlowExpenseEntries,
      financialYear,
      monthEndCloseNetPay,
    ),
  );
  const totalLiabilities = roundMonthlyTotals(
    sumMonthlyTotals([accountsPayable, accruedWagesPayable]),
  );

  const shareCapital = roundMonthlyTotals(
    calculateShareCapitalByMonth(capitalContributions, financialYear),
  );
  const retainedEarnings = roundMonthlyTotals(
    calculateRetainedEarningsByMonth(
      incomeEntries,
      expenseEntries,
      fixedAssets,
      financialYear,
    ),
  );
  const inventoryOpeningEquity = roundMonthlyTotals(
    calculateInventoryOpeningEquityByMonth(inventoryInput.config, financialYear),
  );
  const totalEquity = roundMonthlyTotals(
    sumMonthlyTotals([shareCapital, retainedEarnings, inventoryOpeningEquity]),
  );
  const totalLiabilitiesAndEquity = roundMonthlyTotals(
    sumMonthlyTotals([
      accountsPayable,
      accruedWagesPayable,
      shareCapital,
      retainedEarnings,
      inventoryOpeningEquity,
    ]),
  );

  const rows: BalanceSheetRow[] = [
    {
      key: "assets-section",
      label: "ASSETS",
      amounts: createEmptyMonthlyTotals(),
      kind: "section",
      side: "assets",
    },
    {
      key: "cash",
      label: "Cash and Cash Equivalents",
      amounts: cash,
      kind: "data",
      side: "assets",
    },
    {
      key: "accounts-receivable",
      label: "Accounts Receivable",
      amounts: accountsReceivable,
      kind: "data",
      side: "assets",
    },
    {
      key: "fixed-assets-net",
      label: "Fixed Assets (Net)",
      amounts: fixedAssetsNet,
      kind: "data",
      side: "assets",
    },
    {
      key: "inventory",
      label: "Inventory",
      amounts: inventory,
      kind: "data",
      side: "assets",
    },
    {
      key: "total-assets",
      label: "TOTAL ASSETS",
      amounts: totalAssets,
      kind: "subtotal",
      side: "assets",
    },
    {
      key: "liabilities-section",
      label: "LIABILITIES",
      amounts: createEmptyMonthlyTotals(),
      kind: "section",
      side: "liabilities",
    },
    {
      key: "accounts-payable",
      label: "Accounts Payable",
      amounts: accountsPayable,
      kind: "data",
      side: "liabilities",
    },
    {
      key: "accrued-wages-payable",
      label: "Accrued Wages Payable",
      amounts: accruedWagesPayable,
      kind: "data",
      side: "liabilities",
    },
    {
      key: "total-liabilities",
      label: "TOTAL LIABILITIES",
      amounts: totalLiabilities,
      kind: "subtotal",
      side: "liabilities",
    },
    {
      key: "equity-section",
      label: "EQUITY",
      amounts: createEmptyMonthlyTotals(),
      kind: "section",
      side: "equity",
    },
    {
      key: "share-capital",
      label: "Share Capital",
      amounts: shareCapital,
      kind: "data",
      side: "equity",
    },
    {
      key: "retained-earnings",
      label: "Retained Earnings",
      amounts: retainedEarnings,
      kind: "data",
      side: "equity",
    },
    {
      key: "inventory-opening-equity",
      label: "Inventory Opening Balance",
      amounts: inventoryOpeningEquity,
      kind: "data",
      side: "equity",
    },
    {
      key: "total-equity",
      label: "TOTAL EQUITY",
      amounts: totalEquity,
      kind: "subtotal",
      side: "equity",
    },
    {
      key: "total-liabilities-equity",
      label: "TOTAL LIABILITIES + EQUITY",
      amounts: totalLiabilitiesAndEquity,
      kind: "total",
      side: "combined",
    },
  ];

  return {
    financialYear,
    rows,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalLiabilitiesAndEquity,
  };
}
