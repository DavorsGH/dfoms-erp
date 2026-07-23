import { getCurrentFinancialYear } from "./finance-year-utils";
import {
  isCashOutflowExpense,
  type BalanceSheetCashExpenseEntry,
} from "./accrued-wages-utils";
import type { CapitalContributionEntry } from "./capital-contributions-utils";
import {
  buildClosingCashByMonth,
  buildMonthlyCashComponents,
  buildOpeningCashDisplayByMonth,
  resolveJanuaryOpeningCashBalance,
} from "./cash-movement-utils";
import {
  addAmountToMonth,
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  getEntryMonthIndex,
  sumMonthlyTotals,
  type MonthlyTotals,
  type ProfitLossAssetEntry,
} from "./profit-loss-utils";
import type {
  InventoryBalanceConfig,
  ProductPurchaseCashEntry,
  RawMaterialPurchaseCashEntry,
} from "../inventory/inventory-balance-sheet-utils";

export { MONTH_LABELS, FULL_YEAR_INDEX } from "./profit-loss-utils";
export { getCurrentFinancialYear } from "./finance-year-utils";

export type CashFlowIncomeEntry = {
  date?: string | null;
  period_month?: string | null;
  amount_received: number;
  entry_type?: string | null;
  sale_status?: string | null;
};

export type CashFlowExpenseEntry = {
  date: string;
  sub_category: string;
  amount: number;
  payment_status: string;
  expense_category?: string;
  description?: string | null;
  receipt_no?: string | null;
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
  /** Deprecated for Cash Flow: FA purchases now come from fixed_assets register. */
  purchase_of_fixed_assets?: number;
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

function negateMonthlyTotals(totals: MonthlyTotals): MonthlyTotals {
  return totals.map((value) => -value);
}

function groupPaidExpensesBySubCategory(
  entries: CashFlowExpenseEntry[],
  financialYear: number,
): CashFlowRow[] {
  const grouped = new Map<string, MonthlyTotals>();

  for (const entry of entries) {
    const cashExpense: BalanceSheetCashExpenseEntry = {
      date: entry.date,
      expense_category: entry.expense_category ?? "",
      sub_category: entry.sub_category,
      amount: entry.amount,
      payment_status: entry.payment_status,
      description: entry.description ?? null,
      receipt_no: entry.receipt_no ?? null,
    };
    if (!isCashOutflowExpense(cashExpense)) {
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

const EMPTY_INVENTORY_PURCHASE_INPUT: CashFlowInventoryPurchaseInput = {
  rawMaterialCashPurchases: [],
  productCashPurchases: [],
  inventoryConfig: null,
};

/**
 * Cash Flow Statement built from the shared cash-movement engine so closing
 * cash always matches Balance Sheet cash for the same inputs/year.
 */
export function buildCashFlowReport(
  incomeEntries: CashFlowIncomeEntry[],
  expenseEntries: CashFlowExpenseEntry[],
  manualEntries: ManualFinancialEntry[],
  financialYear = getCurrentFinancialYear(),
  inventoryPurchases: CashFlowInventoryPurchaseInput = EMPTY_INVENTORY_PURCHASE_INPUT,
  fixedAssets: ProfitLossAssetEntry[] = [],
  capitalContributions: CapitalContributionEntry[] = [],
): CashFlowReport {
  const rows: CashFlowRow[] = [];

  const expenseForCash: BalanceSheetCashExpenseEntry[] = expenseEntries.map(
    (entry) => ({
      date: entry.date,
      expense_category: entry.expense_category ?? "",
      sub_category: entry.sub_category,
      amount: entry.amount,
      payment_status: entry.payment_status,
      description: entry.description ?? null,
      receipt_no: entry.receipt_no ?? null,
    }),
  );

  const components = buildMonthlyCashComponents(
    {
      incomeEntries,
      expenseEntries: expenseForCash,
      capitalContributions,
      fixedAssets,
      rawMaterialCashPurchases: inventoryPurchases.rawMaterialCashPurchases,
      productCashPurchases: inventoryPurchases.productCashPurchases,
      inventoryConfig: inventoryPurchases.inventoryConfig,
      manualEntries,
    },
    financialYear,
  );

  const totalCashInflows = [
    components.incomeReceived,
    components.capitalContributions,
    components.otherCashInflows,
  ].reduce((acc, part) => {
    const next = createEmptyMonthlyTotals();
    for (let i = 0; i < next.length; i += 1) {
      next[i] = (acc[i] ?? 0) + (part[i] ?? 0);
    }
    return next;
  }, createEmptyMonthlyTotals());

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
      amounts: components.incomeReceived,
      kind: "data",
    },
    {
      key: "capital-contributions",
      label: "Capital Contributions",
      amounts: components.capitalContributions,
      kind: "data",
    },
    {
      key: "other-inflows",
      label: "Other Cash Inflows",
      amounts: components.otherCashInflows,
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

  const inventoryOutflowRows: CashFlowRow[] = [
    {
      key: "outflow-raw-material-cash-purchases",
      label: "Raw Material Purchases (Cash)",
      amounts: components.rawMaterialPurchases,
      kind: "data" as const,
    },
    {
      key: "outflow-product-cash-purchases",
      label: "Product Purchases (Cash)",
      amounts: components.productPurchases,
      kind: "data" as const,
    },
  ].filter((row) => row.amounts.some((amount) => amount !== 0));

  const totalCashOutflows = sumMonthlyTotals([
    ...outflowRows.map((row) => row.amounts),
    components.rawMaterialPurchases,
    components.productPurchases,
  ]);

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

  // Investing: display purchases as positive outflow amounts; net investing is negative cash.
  const purchaseOfFixedAssets = components.fixedAssetPurchases;
  const netInvesting = negateMonthlyTotals(purchaseOfFixedAssets);

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

  const loanProceeds = components.loanProceeds;
  const loanRepayments = components.loanRepayments;
  const netFinancing = loanProceeds.map((value, index) =>
    (value ?? 0) - (loanRepayments[index] ?? 0),
  );

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

  const januaryOpening = resolveJanuaryOpeningCashBalance(
    manualEntries,
    financialYear,
  );
  const closingCashBalance = buildClosingCashByMonth(
    components.netMovement,
    januaryOpening,
  );
  const openingCashBalance = buildOpeningCashDisplayByMonth(
    closingCashBalance,
    januaryOpening,
  );

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
      amounts: components.netMovement,
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
    entries.find(
      (entry) => entry.period_month.slice(0, 10) === targetPeriodMonth,
    ) ?? null
  );
}

export function filterManualEntriesForYear(
  entries: ManualFinancialEntry[],
  financialYear: number,
) {
  return entries.filter((entry) => {
    const parts = getPeriodMonthParts(entry.period_month);
    return parts?.year === financialYear;
  });
}
