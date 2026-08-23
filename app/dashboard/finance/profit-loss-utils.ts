import {
  PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT,
  PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES,
} from "../hr-payroll/payroll-lock-finance-utils";
import { calculateMonthlyDepreciationTotals } from "./fixed-assets-utils";
import { getCurrentFinancialYear } from "./finance-year-utils";
import {
  isActiveIncomeForReporting,
  resolveProfitLossRevenueCategory,
} from "./income-register-utils";
import { STATUTORY_REMITTANCE_EXPENSE_CATEGORY } from "./tax-ledger-remit";

export const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const FULL_YEAR_INDEX = 12;

export type ProfitLossIncomeEntry = {
  date: string;
  service_category: string | null;
  amount: number;
  entry_type?: "service" | "product_sale" | null;
  sale_status?: "active" | "voided" | null;
  /** Prefer for P&L when set — revenue is net of output VAT/VFRS. */
  net_of_tax_amount?: number | null;
  output_vat_amount?: number | null;
};

export type ProfitLossExpenseEntry = {
  date: string;
  expense_category: string;
  sub_category: string;
  amount: number;
  /** Prefer for P&L when set — expense is net of reclaimable input VAT. */
  net_of_tax_amount?: number | null;
  input_vat_amount?: number | null;
};

/**
 * P&L revenue recognition (tax-exclusive):
 *   prefer net_of_tax_amount
 *   else amount − output_vat_amount
 *   else amount
 * WHT must NOT reduce revenue — customer withholding is a receivable, not a
 * revenue contra.
 */
export function getTaxExclusiveRevenueAmount(entry: {
  amount: number;
  net_of_tax_amount?: number | null;
  output_vat_amount?: number | null;
}): number {
  if (entry.net_of_tax_amount != null) {
    return Number(entry.net_of_tax_amount) || 0;
  }

  const amount = Number(entry.amount) || 0;
  if (entry.output_vat_amount != null) {
    return Math.max(0, amount - (Number(entry.output_vat_amount) || 0));
  }

  return amount;
}

/**
 * P&L expense recognition (tax-exclusive):
 *   prefer net_of_tax_amount
 *   else amount − input_vat_amount
 *   else amount
 * WHT must NOT reduce expense — supplier withholding is a GRA payable, not an
 * expense contra.
 */
export function getTaxExclusiveExpenseAmount(entry: {
  amount: number;
  net_of_tax_amount?: number | null;
  input_vat_amount?: number | null;
}): number {
  if (entry.net_of_tax_amount != null) {
    return Number(entry.net_of_tax_amount) || 0;
  }

  const amount = Number(entry.amount) || 0;
  if (entry.input_vat_amount != null) {
    return Math.max(0, amount - (Number(entry.input_vat_amount) || 0));
  }

  return amount;
}

export type ProfitLossAssetEntry = {
  original_cost: number;
  quantity: number;
  useful_life_years: number;
  purchase_date: string;
  depreciation_method: string;
  tenant_id?: string | null;
  payment_method?: string | null;
  /** WHT withheld on purchase — reduces cash outflow for cash buys. */
  wht_amount?: number | null;
  /** Capitalized cost ex reclaimable input VAT (when purchase tax applies). */
  net_of_tax_amount?: number | null;
};

export type MonthlyTotals = number[];

export type ProfitLossRow = {
  key: string;
  label: string;
  amounts: MonthlyTotals;
  kind:
    | "section"
    | "data"
    | "subtotal"
    | "total"
    | "metric"
    | "percent";
};

export type ProfitLossReport = {
  financialYear: number;
  rows: ProfitLossRow[];
};

const EXPENSE_SECTIONS = [
  {
    key: "cost-of-goods-sold",
    title: "COST OF GOODS SOLD",
    category: "Cost of Goods Sold",
    subtotalLabel: "Total Cost of Goods Sold",
  },
  {
    key: "direct-operational",
    title: "DIRECT OPERATIONAL EXPENSES",
    category: "Direct Operational",
    subtotalLabel: "Total Direct Operational",
  },
  {
    key: "administrative",
    title: "ADMINISTRATIVE EXPENSES",
    category: "Administrative",
    subtotalLabel: "Total Administrative",
  },
  {
    key: "marketing",
    title: "MARKETING EXPENSES",
    category: "Marketing",
    subtotalLabel: "Total Marketing",
  },
  {
    key: "finance",
    title: "FINANCE EXPENSES",
    category: "Finance",
    subtotalLabel: "Total Finance",
  },
  {
    key: "staff-salaries",
    title: "STAFF SALARIES",
    category: PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES,
    subtotalLabel: "Total Staff Salaries",
  },
  {
    key: "employer-ssnit",
    title: "EMPLOYER SSNIT CONTRIBUTION",
    category: PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT,
    subtotalLabel: "Total Employer SSNIT Contribution",
  },
  {
    key: "other",
    title: "OTHER EXPENSES",
    category: "Other",
    subtotalLabel: "Total Other",
  },
] as const;

export type PnlExpenseSectionCategory =
  (typeof EXPENSE_SECTIONS)[number]["category"];

/** Categories that map 1:1 into an EXPENSE_SECTIONS row (excludes fallback). */
export function isMappedProfitLossExpenseCategory(
  expenseCategory: string | null | undefined,
): boolean {
  const normalized = normalizeCategoryName(expenseCategory ?? "");
  if (!normalized) {
    return false;
  }

  return EXPENSE_SECTIONS.some(
    (section) => normalizeCategoryName(section.category) === normalized,
  );
}

/**
 * Resolve expense_register.expense_category to a P&L section category.
 * Unmapped lookup values (e.g. tenant-specific categories) fall back to Other.
 */
export function resolveProfitLossExpenseSectionCategory(
  expenseCategory: string | null | undefined,
): PnlExpenseSectionCategory {
  const normalized = normalizeCategoryName(expenseCategory ?? "");
  if (!normalized) {
    return "Other";
  }

  for (const section of EXPENSE_SECTIONS) {
    if (normalizeCategoryName(section.category) === normalized) {
      return section.category;
    }
  }

  return "Other";
}

/** Liability-settlement rows that must never hit P&L (even via Other fallback). */
export function shouldIncludeExpenseInProfitLoss(
  expenseCategory: string | null | undefined,
): boolean {
  const normalized = normalizeCategoryName(expenseCategory ?? "");
  if (!normalized) {
    return true;
  }

  return (
    normalized !==
    normalizeCategoryName(STATUTORY_REMITTANCE_EXPENSE_CATEGORY)
  );
}

export function createEmptyMonthlyTotals(): MonthlyTotals {
  return Array.from({ length: 13 }, () => 0);
}

export function getEntryMonthIndex(
  date: string | null | undefined,
  financialYear = getCurrentFinancialYear(),
): number | null {
  if (!date) {
    return null;
  }

  const datePart = date.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);

    if (year !== financialYear || month < 1 || month > 12) {
      return null;
    }

    return month - 1;
  }

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() !== financialYear) {
    return null;
  }

  return parsed.getMonth();
}

export function addAmountToMonth(
  totals: MonthlyTotals,
  monthIndex: number,
  amount: number,
) {
  totals[monthIndex] += amount;
  totals[FULL_YEAR_INDEX] += amount;
}

export function sumMonthlyTotals(rows: MonthlyTotals[]): MonthlyTotals {
  const combined = createEmptyMonthlyTotals();

  for (const row of rows) {
    for (let index = 0; index < combined.length; index += 1) {
      combined[index] += row[index] ?? 0;
    }
  }

  return combined;
}

export function normalizeCategoryName(value: string): string {
  return value.trim().toLowerCase();
}

function resolveProfitLossExpenseLineLabel(
  entry: ProfitLossExpenseEntry,
  sectionCategory: string,
): string {
  const subCategory = entry.sub_category?.trim() || "Uncategorized";

  if (normalizeCategoryName(subCategory) === "payroll") {
    const category = entry.expense_category?.trim();
    if (category) {
      return category;
    }
  }

  const originalCategory = entry.expense_category?.trim();
  if (
    normalizeCategoryName(sectionCategory) ===
      normalizeCategoryName("Other") &&
    originalCategory &&
    !isMappedProfitLossExpenseCategory(originalCategory)
  ) {
    return `${originalCategory} — ${subCategory}`;
  }

  return subCategory;
}

function groupIncomeByServiceCategory(
  entries: ProfitLossIncomeEntry[],
  financialYear: number,
): ProfitLossRow[] {
  const grouped = new Map<string, MonthlyTotals>();

  for (const entry of entries) {
    if (!isActiveIncomeForReporting(entry)) {
      continue;
    }

    const monthIndex = getEntryMonthIndex(entry.date, financialYear);
    if (monthIndex === null) {
      continue;
    }

    const category = resolveProfitLossRevenueCategory(entry);
    const totals = grouped.get(category) ?? createEmptyMonthlyTotals();
    addAmountToMonth(totals, monthIndex, getTaxExclusiveRevenueAmount(entry));
    grouped.set(category, totals);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, amounts]) => ({
      key: `revenue-${label}`,
      label,
      amounts,
      kind: "data" as const,
    }));
}

function groupExpensesBySubCategory(
  entries: ProfitLossExpenseEntry[],
  expenseCategory: string,
  financialYear: number,
): ProfitLossRow[] {
  const targetCategory = normalizeCategoryName(expenseCategory);
  const grouped = new Map<string, MonthlyTotals>();

  for (const entry of entries) {
    if (!shouldIncludeExpenseInProfitLoss(entry.expense_category)) {
      continue;
    }

    const resolvedSection = resolveProfitLossExpenseSectionCategory(
      entry.expense_category,
    );
    if (normalizeCategoryName(resolvedSection) !== targetCategory) {
      continue;
    }

    const monthIndex = getEntryMonthIndex(entry.date, financialYear);
    if (monthIndex === null) {
      continue;
    }

    const lineLabel = resolveProfitLossExpenseLineLabel(entry, expenseCategory);
    const totals = grouped.get(lineLabel) ?? createEmptyMonthlyTotals();
    addAmountToMonth(totals, monthIndex, getTaxExclusiveExpenseAmount(entry));
    grouped.set(lineLabel, totals);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, amounts]) => ({
      key: `${expenseCategory}-${label}`,
      label,
      amounts,
      kind: "data" as const,
    }));
}

function calculateDepreciationTotals(
  assets: ProfitLossAssetEntry[],
  financialYear: number,
): MonthlyTotals {
  return calculateMonthlyDepreciationTotals(assets, financialYear);
}

function divideMonthlyTotals(
  numerator: MonthlyTotals,
  denominator: MonthlyTotals,
): MonthlyTotals {
  return numerator.map((value, index) => {
    const divisor = denominator[index] ?? 0;
    return divisor === 0 ? 0 : value / divisor;
  });
}

function subtractMonthlyTotals(
  minuend: MonthlyTotals,
  subtrahend: MonthlyTotals,
): MonthlyTotals {
  return minuend.map((value, index) => value - (subtrahend[index] ?? 0));
}

function buildSectionRows(
  title: string,
  dataRows: ProfitLossRow[],
  subtotalLabel: string,
  subtotalKey: string,
): { rows: ProfitLossRow[]; subtotal: MonthlyTotals } {
  const subtotal = sumMonthlyTotals(dataRows.map((row) => row.amounts));

  return {
    rows: [
      {
        key: `${subtotalKey}-section`,
        label: title,
        amounts: createEmptyMonthlyTotals(),
        kind: "section",
      },
      ...dataRows,
      {
        key: subtotalKey,
        label: subtotalLabel,
        amounts: subtotal,
        kind: "subtotal",
      },
    ],
    subtotal,
  };
}

// Accrual-basis P&L: include every expense_register row for the month,
// regardless of payment_status. Cash outflow filtering belongs only in
// balance-sheet-utils (Cash and Cash Equivalents), not here.
export function buildProfitLossReport(
  incomeEntries: ProfitLossIncomeEntry[],
  expenseEntries: ProfitLossExpenseEntry[],
  fixedAssets: ProfitLossAssetEntry[],
  financialYear = getCurrentFinancialYear(),
): ProfitLossReport {
  const rows: ProfitLossRow[] = [];

  const revenueRows = groupIncomeByServiceCategory(incomeEntries, financialYear);
  const totalRevenue = sumMonthlyTotals(revenueRows.map((row) => row.amounts));

  rows.push({
    key: "revenue-section",
    label: "REVENUE",
    amounts: createEmptyMonthlyTotals(),
    kind: "section",
  });
  rows.push(...revenueRows);
  rows.push({
    key: "total-revenue",
    label: "TOTAL REVENUE",
    amounts: totalRevenue,
    kind: "subtotal",
  });

  const expenseSubtotals: MonthlyTotals[] = [];

  for (const section of EXPENSE_SECTIONS) {
    const dataRows = groupExpensesBySubCategory(
      expenseEntries,
      section.category,
      financialYear,
    );
    const { rows: sectionRows, subtotal } = buildSectionRows(
      section.title,
      dataRows,
      section.subtotalLabel,
      section.key,
    );

    rows.push(...sectionRows);
    expenseSubtotals.push(subtotal);
  }

  const depreciation = calculateDepreciationTotals(fixedAssets, financialYear);

  rows.push({
    key: "depreciation-section",
    label: "DEPRECIATION",
    amounts: createEmptyMonthlyTotals(),
    kind: "section",
  });
  rows.push({
    key: "depreciation",
    label: "Depreciation",
    amounts: depreciation,
    kind: "data",
  });

  const totalExpenses = sumMonthlyTotals([...expenseSubtotals, depreciation]);

  rows.push({
    key: "total-expenses",
    label: "TOTAL EXPENSES",
    amounts: totalExpenses,
    kind: "total",
  });

  const directOperational = expenseSubtotals[1] ?? createEmptyMonthlyTotals();
  const administrative = expenseSubtotals[2] ?? createEmptyMonthlyTotals();
  const marketing = expenseSubtotals[3] ?? createEmptyMonthlyTotals();

  const costOfGoodsSold = expenseSubtotals[0] ?? createEmptyMonthlyTotals();
  const grossProfit = subtractMonthlyTotals(
    totalRevenue,
    sumMonthlyTotals([costOfGoodsSold, directOperational]),
  );
  const operatingProfit = subtractMonthlyTotals(
    grossProfit,
    sumMonthlyTotals([administrative, marketing]),
  );
  const netProfit = subtractMonthlyTotals(totalRevenue, totalExpenses);
  const grossProfitMargin = divideMonthlyTotals(grossProfit, totalRevenue);
  const netProfitMargin = divideMonthlyTotals(netProfit, totalRevenue);

  rows.push({
    key: "profitability-section",
    label: "PROFITABILITY",
    amounts: createEmptyMonthlyTotals(),
    kind: "section",
  });
  rows.push(
    {
      key: "gross-profit",
      label: "Gross Profit",
      amounts: grossProfit,
      kind: "metric",
    },
    {
      key: "operating-profit",
      label: "Operating Profit",
      amounts: operatingProfit,
      kind: "metric",
    },
    {
      key: "net-profit",
      label: "Net Profit",
      amounts: netProfit,
      kind: "metric",
    },
    {
      key: "gross-profit-margin",
      label: "Gross Profit Margin %",
      amounts: grossProfitMargin,
      kind: "percent",
    },
    {
      key: "net-profit-margin",
      label: "Net Profit Margin %",
      amounts: netProfitMargin,
      kind: "percent",
    },
  );

  return {
    financialYear,
    rows,
  };
}
