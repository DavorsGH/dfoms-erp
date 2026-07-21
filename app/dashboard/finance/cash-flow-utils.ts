import { getCurrentFinancialYear } from "./finance-year-utils";
import {
  addAmountToMonth,
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  getEntryMonthIndex,
  sumMonthlyTotals,
  type MonthlyTotals,
} from "./profit-loss-utils";
import {
  calculateProductPurchaseCashOutflowsByMonth,
  calculateRawMaterialPurchaseCashOutflowsByMonth,
  type InventoryBalanceConfig,
  type ProductPurchaseCashEntry,
  type RawMaterialPurchaseCashEntry,
} from "../inventory/inventory-balance-sheet-utils";

export { MONTH_LABELS, FULL_YEAR_INDEX } from "./profit-loss-utils";
export { getCurrentFinancialYear } from "./finance-year-utils";

export type CashFlowIncomeEntry = {
  date?: string | null;
  period_month?: string | null;
  amount_received: number;
};

export type CashFlowExpenseEntry = {
  date: string;
  sub_category: string;
  amount: number;
  payment_status: string;
};

/**
 * Cash inventory purchases (raw materials + finished products) never enter
 * expense_register, so the Cash Flow Statement must read them directly —
 * same sources the Balance Sheet cash calculation uses.
 */
export type CashFlowInventoryPurchaseInput = {
  rawMaterialCashPurchases: RawMaterialPurchaseCashEntry[];
  productCashPurchases: ProductPurchaseCashEntry[];
  inventoryConfig: InventoryBalanceConfig | null;
};

export type ManualFinancialEntry = {
  id?: string;
  period_month: string;
  cash_on_hand?: number;
  bank_balance?: number;
  prepayments_wht_receivable?: number;
  inventory_consumables?: number;
  accrued_expenses?: number;
  withholding_tax_payable?: number;
  vat_payable?: number;
  bank_loans?: number;
  other_long_term_liabilities?: number;
  retained_earnings_prior_years?: number;
  share_capital?: number;
  purchase_of_fixed_assets: number;
  loan_proceeds: number;
  loan_repayments: number;
  opening_cash_balance: number;
  other_cash_inflows: number;
};

export function buildPeriodMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function getPeriodMonthParts(
  periodMonth: string,
): { year: number; month: number } | null {
  const datePart = periodMonth.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 12) {
    return null;
  }

  return { year, month };
}

function resolveIncomeEntryDate(entry: CashFlowIncomeEntry): string | null {
  const value = entry.date ?? entry.period_month;
  return value ? String(value) : null;
}

export type CashFlowRow = {
  key: string;
  label: string;
  amounts: MonthlyTotals;
  kind: "section" | "data" | "subtotal" | "total" | "metric" | "balance";
  balanceFullYear?: "january" | "december";
};

export type CashFlowReport = {
  financialYear: number;
  rows: CashFlowRow[];
};

function subtractMonthlyTotals(
  minuend: MonthlyTotals,
  subtrahend: MonthlyTotals,
): MonthlyTotals {
  return minuend.map((value, index) => value - (subtrahend[index] ?? 0));
}

function addMonthlyTotals(
  left: MonthlyTotals,
  right: MonthlyTotals,
): MonthlyTotals {
  return left.map((value, index) => value + (right[index] ?? 0));
}

function isPaidStatus(paymentStatus: string): boolean {
  return paymentStatus.trim().toLowerCase() === "paid";
}

function sumCashReceivedByMonth(
  entries: CashFlowIncomeEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (const entry of entries) {
    const monthIndex = getEntryMonthIndex(
      resolveIncomeEntryDate(entry),
      financialYear,
    );
    if (monthIndex === null) {
      continue;
    }

    addAmountToMonth(totals, monthIndex, Number(entry.amount_received) || 0);
  }

  return totals;
}

function groupPaidExpensesBySubCategory(
  entries: CashFlowExpenseEntry[],
  financialYear: number,
): CashFlowRow[] {
  const grouped = new Map<string, MonthlyTotals>();

  for (const entry of entries) {
    if (!isPaidStatus(entry.payment_status)) {
      continue;
    }

    const monthIndex = getEntryMonthIndex(entry.date, financialYear);
    if (monthIndex === null) {
      continue;
    }

    const subCategory = entry.sub_category?.trim() || "Uncategorized";
    const totals = grouped.get(subCategory) ?? createEmptyMonthlyTotals();
    addAmountToMonth(totals, monthIndex, Number(entry.amount) || 0);
    grouped.set(subCategory, totals);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, amounts]) => ({
      key: `outflow-${label}`,
      label,
      amounts,
      kind: "data" as const,
    }));
}

function manualFieldToMonthlyTotals(
  entries: ManualFinancialEntry[],
  field: keyof Pick<
    ManualFinancialEntry,
    | "purchase_of_fixed_assets"
    | "loan_proceeds"
    | "loan_repayments"
    | "opening_cash_balance"
    | "other_cash_inflows"
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
    totals[monthIndex] = Number(entry[field]) || 0;
    totals[FULL_YEAR_INDEX] += Number(entry[field]) || 0;
  }

  return totals;
}

function manualFieldToMonthlyTotalsNoSum(
  entries: ManualFinancialEntry[],
  field: keyof Pick<
    ManualFinancialEntry,
    "opening_cash_balance"
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
    totals[monthIndex] = Number(entry[field]) || 0;
  }

  return totals;
}

function setBalanceFullYear(
  totals: MonthlyTotals,
  mode: "january" | "december",
) {
  totals[FULL_YEAR_INDEX] = mode === "january" ? totals[0] : totals[11];
}

const EMPTY_INVENTORY_PURCHASE_INPUT: CashFlowInventoryPurchaseInput = {
  rawMaterialCashPurchases: [],
  productCashPurchases: [],
  inventoryConfig: null,
};

export function buildCashFlowReport(
  incomeEntries: CashFlowIncomeEntry[],
  expenseEntries: CashFlowExpenseEntry[],
  manualEntries: ManualFinancialEntry[],
  financialYear = getCurrentFinancialYear(),
  inventoryPurchases: CashFlowInventoryPurchaseInput = EMPTY_INVENTORY_PURCHASE_INPUT,
): CashFlowReport {
  const rows: CashFlowRow[] = [];

  const cashReceived = sumCashReceivedByMonth(incomeEntries, financialYear);
  const otherCashInflows = manualFieldToMonthlyTotals(
    manualEntries,
    "other_cash_inflows",
    financialYear,
  );
  const totalCashInflows = addMonthlyTotals(cashReceived, otherCashInflows);

  rows.push({
    key: "inflows-section",
    label: "OPERATING ACTIVITIES - CASH INFLOWS",
    amounts: createEmptyMonthlyTotals(),
    kind: "section",
  });
  rows.push(
    {
      key: "cash-received",
      label: "Cash Received from Customers",
      amounts: cashReceived,
      kind: "data",
    },
    {
      key: "other-inflows",
      label: "Other Cash Inflows",
      amounts: otherCashInflows,
      kind: "data",
    },
    {
      key: "total-inflows",
      label: "TOTAL CASH INFLOWS",
      amounts: totalCashInflows,
      kind: "subtotal",
    },
  );

  const outflowRows = groupPaidExpensesBySubCategory(
    expenseEntries,
    financialYear,
  );

  // Cash inventory purchases: mirrors the Balance Sheet cash calculation
  // (calculateCashAndCashEquivalentsByMonth), which subtracts the same values.
  const rawMaterialCashOutflows = calculateRawMaterialPurchaseCashOutflowsByMonth(
    inventoryPurchases.rawMaterialCashPurchases,
    inventoryPurchases.inventoryConfig,
    financialYear,
  );
  const productCashOutflows = calculateProductPurchaseCashOutflowsByMonth(
    inventoryPurchases.productCashPurchases,
    inventoryPurchases.inventoryConfig,
    financialYear,
  );

  const inventoryOutflowRows: CashFlowRow[] = [
    {
      key: "outflow-raw-material-cash-purchases",
      label: "Raw Material Purchases (Cash)",
      amounts: rawMaterialCashOutflows,
      kind: "data" as const,
    },
    {
      key: "outflow-product-cash-purchases",
      label: "Product Purchases (Cash)",
      amounts: productCashOutflows,
      kind: "data" as const,
    },
  ].filter((row) => row.amounts.some((amount) => amount !== 0));

  const totalCashOutflows = sumMonthlyTotals(
    [...outflowRows, ...inventoryOutflowRows].map((row) => row.amounts),
  );

  rows.push({
    key: "outflows-section",
    label: "OPERATING ACTIVITIES - CASH OUTFLOWS",
    amounts: createEmptyMonthlyTotals(),
    kind: "section",
  });
  rows.push(...outflowRows, ...inventoryOutflowRows);
  rows.push({
    key: "total-outflows",
    label: "TOTAL CASH OUTFLOWS",
    amounts: totalCashOutflows,
    kind: "subtotal",
  });

  const purchaseOfFixedAssets = manualFieldToMonthlyTotals(
    manualEntries,
    "purchase_of_fixed_assets",
    financialYear,
  );
  const netInvesting = [...purchaseOfFixedAssets];

  rows.push({
    key: "investing-section",
    label: "INVESTING ACTIVITIES",
    amounts: createEmptyMonthlyTotals(),
    kind: "section",
  });
  rows.push(
    {
      key: "purchase-fixed-assets",
      label: "Purchase of Fixed Assets",
      amounts: purchaseOfFixedAssets,
      kind: "data",
    },
    {
      key: "net-investing",
      label: "Net Investing Cash Flows",
      amounts: netInvesting,
      kind: "metric",
    },
  );

  const loanProceeds = manualFieldToMonthlyTotals(
    manualEntries,
    "loan_proceeds",
    financialYear,
  );
  const loanRepayments = manualFieldToMonthlyTotals(
    manualEntries,
    "loan_repayments",
    financialYear,
  );
  const netFinancing = subtractMonthlyTotals(loanProceeds, loanRepayments);

  rows.push({
    key: "financing-section",
    label: "FINANCING ACTIVITIES",
    amounts: createEmptyMonthlyTotals(),
    kind: "section",
  });
  rows.push(
    {
      key: "loan-proceeds",
      label: "Loan Proceeds",
      amounts: loanProceeds,
      kind: "data",
    },
    {
      key: "loan-repayments",
      label: "Loan Repayments",
      amounts: loanRepayments,
      kind: "data",
    },
    {
      key: "net-financing",
      label: "Net Financing Cash Flows",
      amounts: netFinancing,
      kind: "metric",
    },
  );

  const netCashMovement = addMonthlyTotals(
    subtractMonthlyTotals(totalCashInflows, totalCashOutflows),
    addMonthlyTotals(netInvesting, netFinancing),
  );

  const openingCashBalance = manualFieldToMonthlyTotalsNoSum(
    manualEntries,
    "opening_cash_balance",
    financialYear,
  );
  setBalanceFullYear(openingCashBalance, "january");

  const closingCashBalance = addMonthlyTotals(
    netCashMovement,
    openingCashBalance,
  );
  setBalanceFullYear(closingCashBalance, "december");

  rows.push({
    key: "net-cash-section",
    label: "NET CASH POSITION",
    amounts: createEmptyMonthlyTotals(),
    kind: "section",
  });
  rows.push(
    {
      key: "net-cash-movement",
      label: "NET CASH MOVEMENT",
      amounts: netCashMovement,
      kind: "total",
    },
    {
      key: "opening-cash-balance",
      label: "Opening Cash Balance",
      amounts: openingCashBalance,
      kind: "balance",
      balanceFullYear: "january",
    },
    {
      key: "closing-cash-balance",
      label: "CLOSING CASH BALANCE",
      amounts: closingCashBalance,
      kind: "balance",
      balanceFullYear: "december",
    },
  );

  return {
    financialYear,
    rows,
  };
}

export const emptyManualEntryForm = {
  purchase_of_fixed_assets: "",
  loan_proceeds: "",
  loan_repayments: "",
  opening_cash_balance: "",
  other_cash_inflows: "",
};

export function getManualEntryForMonth(
  entries: ManualFinancialEntry[],
  financialYear: number,
  month: number,
) {
  const targetPeriodMonth = buildPeriodMonth(financialYear, month);

  return (
    entries.find((entry) => entry.period_month.slice(0, 10) === targetPeriodMonth) ??
    null
  );
}

export function filterManualEntriesForYear(
  entries: ManualFinancialEntry[],
  financialYear: number,
): ManualFinancialEntry[] {
  return entries.filter((entry) => {
    const parts = getPeriodMonthParts(entry.period_month);
    return parts?.year === financialYear;
  });
}
