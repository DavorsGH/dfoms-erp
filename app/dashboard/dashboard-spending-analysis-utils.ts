import { isActiveIncomeForReporting } from "./finance/income-register-utils";

export type SpendingAnalysisIncomeRow = {
  date: string;
  amount: number;
  service_category: string | null;
  description: string | null;
};

export type SpendingAnalysisExpenseRow = {
  date: string;
  amount: number;
  expense_category: string;
  description: string | null;
};

export type SpendingAnalysisPeriodMode = "month" | "year";
export type SpendingAnalysisGrouping = "category" | "item";

export type SpendingAnalysisRankedItem = {
  label: string;
  amount: number;
};

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

function blankLabel(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "(Blank)";
}

export function entryInAnalysisPeriod(
  date: string,
  mode: SpendingAnalysisPeriodMode,
  periodKey: string,
): boolean {
  const normalized = normalizeDate(date);
  if (mode === "month") {
    return normalized.slice(0, 7) === periodKey;
  }
  return normalized.slice(0, 4) === periodKey;
}

function aggregateTop(
  rows: Array<{ label: string; amount: number }>,
  limit = 10,
): SpendingAnalysisRankedItem[] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const label = blankLabel(row.label);
    totals.set(label, (totals.get(label) ?? 0) + (Number(row.amount) || 0));
  }

  return [...totals.entries()]
    .map(([label, amount]) => ({
      label,
      amount: Math.round(amount * 100) / 100,
    }))
    .filter((item) => item.amount !== 0)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, limit);
}

export function buildTopExpenseAnalysis(
  expenses: SpendingAnalysisExpenseRow[],
  mode: SpendingAnalysisPeriodMode,
  periodKey: string,
  grouping: SpendingAnalysisGrouping,
): SpendingAnalysisRankedItem[] {
  const inPeriod = expenses.filter((entry) =>
    entryInAnalysisPeriod(entry.date, mode, periodKey),
  );

  return aggregateTop(
    inPeriod.map((entry) => ({
      label:
        grouping === "category"
          ? blankLabel(entry.expense_category)
          : blankLabel(entry.description),
      amount: entry.amount,
    })),
  );
}

export function buildTopIncomeAnalysis(
  income: SpendingAnalysisIncomeRow[],
  mode: SpendingAnalysisPeriodMode,
  periodKey: string,
  grouping: SpendingAnalysisGrouping,
): SpendingAnalysisRankedItem[] {
  const inPeriod = income.filter((entry) =>
    entryInAnalysisPeriod(entry.date, mode, periodKey),
  );

  return aggregateTop(
    inPeriod.map((entry) => ({
      label:
        grouping === "category"
          ? blankLabel(entry.service_category)
          : blankLabel(entry.description),
      amount: entry.amount,
    })),
  );
}

export function collectAnalysisMonthKeys(
  income: SpendingAnalysisIncomeRow[],
  expenses: SpendingAnalysisExpenseRow[],
): string[] {
  const keys = new Set<string>();
  for (const entry of [...income, ...expenses]) {
    const month = normalizeDate(entry.date).slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) {
      keys.add(month);
    }
  }

  const now = new Date();
  keys.add(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );

  return [...keys].sort((left, right) => right.localeCompare(left));
}

export function collectAnalysisYearKeys(
  income: SpendingAnalysisIncomeRow[],
  expenses: SpendingAnalysisExpenseRow[],
): string[] {
  const keys = new Set<string>();
  for (const entry of [...income, ...expenses]) {
    const year = normalizeDate(entry.date).slice(0, 4);
    if (/^\d{4}$/.test(year)) {
      keys.add(year);
    }
  }

  keys.add(String(new Date().getFullYear()));
  return [...keys].sort((left, right) => right.localeCompare(left));
}

export function formatAnalysisMonthLabel(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) {
    return monthKey;
  }
  return new Date(year, month - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

export function toSpendingAnalysisIncomeRows(
  rows: Array<{
    date: string;
    amount: number;
    service_category?: string | null;
    description?: string | null;
    entry_type?: string | null;
    sale_status?: string | null;
  }>,
): SpendingAnalysisIncomeRow[] {
  return rows
    .filter((entry) =>
      isActiveIncomeForReporting({
        entry_type:
          entry.entry_type === "product_sale" ? "product_sale" : "service",
        sale_status: entry.sale_status === "voided" ? "voided" : "active",
      }),
    )
    .map((entry) => ({
      date: entry.date,
      amount: Number(entry.amount) || 0,
      service_category: entry.service_category ?? null,
      description: entry.description ?? null,
    }));
}

export function toSpendingAnalysisExpenseRows(
  rows: Array<{
    date: string;
    amount: number;
    expense_category?: string | null;
    description?: string | null;
  }>,
): SpendingAnalysisExpenseRow[] {
  return rows.map((entry) => ({
    date: entry.date,
    amount: Number(entry.amount) || 0,
    expense_category: entry.expense_category ?? "",
    description: entry.description ?? null,
  }));
}
