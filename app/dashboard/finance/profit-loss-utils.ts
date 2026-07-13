import { calculateMonthlyDepreciationTotals } from "./fixed-assets-utils";
import { getCurrentFinancialYear } from "./finance-year-utils";

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
  service_category: string;
  amount: number;
};

export type ProfitLossExpenseEntry = {
  date: string;
  expense_category: string;
  sub_category: string;
  amount: number;
};

export type ProfitLossAssetEntry = {
  original_cost: number;
  quantity: number;
  useful_life_years: number;
  purchase_date: string;
  depreciation_method: string;
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
    key: "other",
    title: "OTHER EXPENSES",
    category: "Other",
    subtotalLabel: "Total Other",
  },
] as const;

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

function groupIncomeByServiceCategory(
  entries: ProfitLossIncomeEntry[],
  financialYear: number,
): ProfitLossRow[] {
  const grouped = new Map<string, MonthlyTotals>();

  for (const entry of entries) {
    const monthIndex = getEntryMonthIndex(entry.date, financialYear);
    if (monthIndex === null) {
      continue;
    }

    const category = entry.service_category?.trim() || "Uncategorized";
    const totals = grouped.get(category) ?? createEmptyMonthlyTotals();
    addAmountToMonth(totals, monthIndex, Number(entry.amount) || 0);
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
    if (normalizeCategoryName(entry.expense_category) !== targetCategory) {
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

  const directOperational = expenseSubtotals[0] ?? createEmptyMonthlyTotals();
  const administrative = expenseSubtotals[1] ?? createEmptyMonthlyTotals();
  const marketing = expenseSubtotals[2] ?? createEmptyMonthlyTotals();
  const finance = expenseSubtotals[3] ?? createEmptyMonthlyTotals();
  const other = expenseSubtotals[4] ?? createEmptyMonthlyTotals();

  const grossProfit = subtractMonthlyTotals(totalRevenue, directOperational);
  const operatingProfit = subtractMonthlyTotals(
    grossProfit,
    sumMonthlyTotals([administrative, marketing]),
  );
  const netProfit = subtractMonthlyTotals(
    operatingProfit,
    sumMonthlyTotals([finance, other, depreciation]),
  );
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
