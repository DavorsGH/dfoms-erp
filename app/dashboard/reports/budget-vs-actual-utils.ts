import { PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES } from "../hr-payroll/payroll-lock-finance-utils";
import type { ContractProjectOption } from "../administration/projects-utils";
import {
  buildAnnualPeriodMonth,
  formatBudgetCategoryLabel,
  isAnnualBudget,
  normalizeBudgetSubcategory,
  normalizePeriodMonth,
  type BudgetRecord,
} from "../finance/budget-utils";
import { getPeriodMonthParts } from "../finance/cash-flow-utils";
import { getEntryMonthIndex } from "../finance/profit-loss-utils";

export type BudgetActualExpenseEntry = {
  date: string;
  expense_category: string | null;
  /** Matches expense_register.sub_category */
  sub_category?: string | null;
  amount: number;
  project_id?: string | null;
};

export type BudgetActualInventoryPurchaseEntry = {
  purchase_date: string;
  total_cost: number;
  project_id?: string | null;
};

export type BudgetActualPayrollRow = {
  payroll_month: string;
  gross_pay: number;
  project_contract: string | null;
};

export const BUDGET_ACTUAL_CATEGORY_RAW_MATERIALS = "Raw Materials";
export const BUDGET_ACTUAL_CATEGORY_PURCHASED_INVENTORY = "Purchased Inventory";

export type BudgetVsActualViewMode =
  | "monthly-prorated"
  | "monthly-ytd"
  | "annual";

export type BudgetHealthStatus = "green" | "amber" | "red";

export type BudgetVsActualRow = {
  rowKey: string;
  category: string;
  subcategory: string | null;
  rowLabel: string;
  budgeted: number;
  actual: number;
  variance: number;
  variancePercent: number | null;
  remaining: number;
  status: BudgetHealthStatus;
  countActualInTotals: boolean;
};

export const ALL_PROJECTS_FILTER = "__all__";

export const BUDGET_VS_ACTUAL_VIEW_OPTIONS: Array<{
  value: BudgetVsActualViewMode;
  label: string;
}> = [
  { value: "monthly-prorated", label: "Monthly (Pro-rated)" },
  { value: "monthly-ytd", label: "Monthly (Year-to-Date)" },
  { value: "annual", label: "Annual" },
];

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveBudgetHealthStatus(
  budgeted: number,
  actual: number,
): BudgetHealthStatus {
  if (budgeted <= 0) {
    return actual > 0 ? "red" : "green";
  }

  const utilization = actual / budgeted;
  if (utilization > 1) {
    return "red";
  }

  if (utilization >= 0.8) {
    return "amber";
  }

  return "green";
}

export function budgetHealthStatusClassName(status: BudgetHealthStatus): string {
  switch (status) {
    case "green":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "amber":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "red":
      return "bg-red-50 text-red-700 border-red-200";
  }
}

export function budgetHealthStatusLabel(status: BudgetHealthStatus): string {
  switch (status) {
    case "green":
      return "Under 80%";
    case "amber":
      return "80–100%";
    case "red":
      return "Over budget";
  }
}

function matchesProjectFilter(
  projectId: string | null | undefined,
  projectFilter: string,
): boolean {
  if (projectFilter === ALL_PROJECTS_FILTER) {
    return true;
  }

  return (projectId ?? null) === projectFilter;
}

function budgetMatchesProject(
  entry: BudgetRecord,
  projectFilter: string,
): boolean {
  if (projectFilter === ALL_PROJECTS_FILTER) {
    return true;
  }

  return (entry.project_id ?? null) === projectFilter;
}

function budgetInYear(entry: BudgetRecord, year: number): boolean {
  const parts = getPeriodMonthParts(entry.period_month);
  return parts?.year === year;
}

function makeBudgetLineKey(
  category: string,
  subcategory: string | null | undefined,
): string {
  return `${category.trim()}\u0000${normalizeBudgetSubcategory(subcategory) ?? ""}`;
}

function parseBudgetLineKey(key: string): {
  category: string;
  subcategory: string | null;
} {
  const separator = key.indexOf("\u0000");
  if (separator === -1) {
    return { category: key, subcategory: null };
  }

  const category = key.slice(0, separator);
  const subcategoryPart = key.slice(separator + 1);
  return {
    category,
    subcategory: subcategoryPart === "" ? null : subcategoryPart,
  };
}

function budgetLineKeyFromEntry(entry: BudgetRecord): string {
  return makeBudgetLineKey(entry.category, entry.subcategory);
}

function isInventoryPseudoCategory(category: string): boolean {
  return (
    category === BUDGET_ACTUAL_CATEGORY_RAW_MATERIALS ||
    category === BUDGET_ACTUAL_CATEGORY_PURCHASED_INVENTORY
  );
}

function budgetedSubcategoriesByCategory(
  budgets: BudgetRecord[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  for (const entry of budgets) {
    const subcategory = normalizeBudgetSubcategory(entry.subcategory);
    if (!subcategory || isInventoryPseudoCategory(entry.category.trim())) {
      continue;
    }

    const category = entry.category.trim();
    const set = map.get(category) ?? new Set<string>();
    set.add(subcategory);
    map.set(category, set);
  }

  return map;
}

function expenseMatchesLine(params: {
  entry: BudgetActualExpenseEntry;
  category: string;
  subcategory: string | null;
  budgetedSubs: Set<string>;
}): boolean {
  if ((params.entry.expense_category ?? "").trim() !== params.category) {
    return false;
  }

  const expenseSub = normalizeBudgetSubcategory(params.entry.sub_category);

  if (params.subcategory !== null) {
    return expenseSub === params.subcategory;
  }

  // Whole-category row: exclude actuals already claimed by a separately budgeted subcategory.
  if (expenseSub && params.budgetedSubs.has(expenseSub)) {
    return false;
  }

  return true;
}

function sumExpensesForLineInMonthRange(
  expenses: BudgetActualExpenseEntry[],
  category: string,
  subcategory: string | null,
  budgetedSubs: Set<string>,
  year: number,
  fromMonthIndex: number,
  throughMonthIndex: number,
  projectFilter: string,
): number {
  return roundCurrency(
    expenses.reduce((sum, entry) => {
      if (
        !expenseMatchesLine({
          entry,
          category,
          subcategory,
          budgetedSubs,
        })
      ) {
        return sum;
      }

      const monthIndex = getEntryMonthIndex(entry.date, year);
      if (
        monthIndex === null ||
        monthIndex < fromMonthIndex ||
        monthIndex > throughMonthIndex
      ) {
        return sum;
      }

      if (!matchesProjectFilter(entry.project_id, projectFilter)) {
        return sum;
      }

      return sum + (Number(entry.amount) || 0);
    }, 0),
  );
}

function sumInventoryPurchasesInMonthRange(
  purchases: BudgetActualInventoryPurchaseEntry[],
  year: number,
  fromMonthIndex: number,
  throughMonthIndex: number,
  projectFilter: string,
): number {
  return roundCurrency(
    purchases.reduce((sum, entry) => {
      const monthIndex = getEntryMonthIndex(entry.purchase_date, year);
      if (
        monthIndex === null ||
        monthIndex < fromMonthIndex ||
        monthIndex > throughMonthIndex
      ) {
        return sum;
      }

      if (!matchesProjectFilter(entry.project_id, projectFilter)) {
        return sum;
      }

      return sum + (Number(entry.total_cost) || 0);
    }, 0),
  );
}

function sumPayrollInMonthRange(
  payrollRows: BudgetActualPayrollRow[],
  year: number,
  fromMonth: number,
  throughMonth: number,
  projectCode: string | null,
): number {
  return roundCurrency(
    payrollRows.reduce((sum, row) => {
      const normalized = normalizePeriodMonth(row.payroll_month);
      const match = /^(\d{4})-(\d{2})/.exec(normalized);
      if (!match || Number(match[1]) !== year) {
        return sum;
      }

      const month = Number(match[2]);
      if (month < fromMonth || month > throughMonth) {
        return sum;
      }

      if (projectCode) {
        const assignedProject = row.project_contract?.trim() ?? "";
        if (assignedProject !== projectCode) {
          return sum;
        }
      }

      return sum + (Number(row.gross_pay) || 0);
    }, 0),
  );
}

function computeActualForLine(params: {
  category: string;
  subcategory: string | null;
  budgetedSubs: Set<string>;
  year: number;
  month: number;
  fromMonthIndex: number;
  throughMonthIndex: number;
  projectFilter: string;
  projects: ContractProjectOption[];
  expenses: BudgetActualExpenseEntry[];
  rawMaterialPurchases: BudgetActualInventoryPurchaseEntry[];
  productPurchases: BudgetActualInventoryPurchaseEntry[];
  payrollRows: BudgetActualPayrollRow[];
}): number {
  const {
    category,
    subcategory,
    budgetedSubs,
    year,
    fromMonthIndex,
    throughMonthIndex,
    projectFilter,
    projects,
    expenses,
    rawMaterialPurchases,
    productPurchases,
    payrollRows,
  } = params;

  if (category === BUDGET_ACTUAL_CATEGORY_RAW_MATERIALS) {
    if (subcategory !== null) {
      return 0;
    }

    return sumInventoryPurchasesInMonthRange(
      rawMaterialPurchases,
      year,
      fromMonthIndex,
      throughMonthIndex,
      projectFilter,
    );
  }

  if (category === BUDGET_ACTUAL_CATEGORY_PURCHASED_INVENTORY) {
    if (subcategory !== null) {
      return 0;
    }

    return sumInventoryPurchasesInMonthRange(
      productPurchases,
      year,
      fromMonthIndex,
      throughMonthIndex,
      projectFilter,
    );
  }

  if (category === PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES) {
    if (projectFilter === ALL_PROJECTS_FILTER) {
      return sumExpensesForLineInMonthRange(
        expenses,
        category,
        subcategory,
        budgetedSubs,
        year,
        fromMonthIndex,
        throughMonthIndex,
        ALL_PROJECTS_FILTER,
      );
    }

    // Project-scoped payroll actuals come from payroll history (no subcategory).
    if (subcategory !== null) {
      return 0;
    }

    const project = projects.find((entry) => entry.id === projectFilter);
    if (!project) {
      return 0;
    }

    return sumPayrollInMonthRange(
      payrollRows,
      year,
      fromMonthIndex + 1,
      throughMonthIndex + 1,
      project.project_code,
    );
  }

  return sumExpensesForLineInMonthRange(
    expenses,
    category,
    subcategory,
    budgetedSubs,
    year,
    fromMonthIndex,
    throughMonthIndex,
    projectFilter,
  );
}

function buildReportRow(params: {
  rowKey: string;
  category: string;
  subcategory: string | null;
  rowLabel: string;
  budgeted: number;
  actual: number;
  countActualInTotals: boolean;
}): BudgetVsActualRow {
  const variance = roundCurrency(params.actual - params.budgeted);
  const variancePercent =
    params.budgeted > 0 ? roundCurrency((variance / params.budgeted) * 100) : null;
  const remaining = roundCurrency(params.budgeted - params.actual);

  return {
    rowKey: params.rowKey,
    category: params.category,
    subcategory: params.subcategory,
    rowLabel: params.rowLabel,
    budgeted: params.budgeted,
    actual: params.actual,
    variance,
    variancePercent,
    remaining,
    status: resolveBudgetHealthStatus(params.budgeted, params.actual),
    countActualInTotals: params.countActualInTotals,
  };
}

function getAnnualActualThroughMonthIndex(
  year: number,
  referenceDate = new Date(),
): number {
  const currentYear = referenceDate.getFullYear();
  if (year < currentYear) {
    return 11;
  }

  if (year > currentYear) {
    return -1;
  }

  return referenceDate.getMonth();
}

function monthlyBudgetsForExactMonth(
  budgets: BudgetRecord[],
  periodMonth: string,
  projectFilter: string,
): BudgetRecord[] {
  const normalized = normalizePeriodMonth(periodMonth);
  return budgets.filter(
    (entry) =>
      !isAnnualBudget(entry) &&
      normalizePeriodMonth(entry.period_month) === normalized &&
      budgetMatchesProject(entry, projectFilter),
  );
}

function annualBudgetsForYear(
  budgets: BudgetRecord[],
  year: number,
  projectFilter: string,
): BudgetRecord[] {
  const anchor = buildAnnualPeriodMonth(year);
  return budgets.filter(
    (entry) =>
      isAnnualBudget(entry) &&
      normalizePeriodMonth(entry.period_month) === anchor &&
      budgetMatchesProject(entry, projectFilter),
  );
}

function monthlyBudgetsThroughMonth(
  budgets: BudgetRecord[],
  year: number,
  throughMonth: number,
  projectFilter: string,
): BudgetRecord[] {
  return budgets.filter((entry) => {
    if (isAnnualBudget(entry) || !budgetInYear(entry, year)) {
      return false;
    }

    const parts = getPeriodMonthParts(entry.period_month);
    if (!parts || parts.month > throughMonth) {
      return false;
    }

    return budgetMatchesProject(entry, projectFilter);
  });
}

function allMonthlyBudgetsInYear(
  budgets: BudgetRecord[],
  year: number,
  projectFilter: string,
): BudgetRecord[] {
  return budgets.filter(
    (entry) =>
      !isAnnualBudget(entry) &&
      budgetInYear(entry, year) &&
      budgetMatchesProject(entry, projectFilter),
  );
}

function sumBudgetAmountsByLineKey(entries: BudgetRecord[]): Map<string, number> {
  const totals = new Map<string, number>();

  for (const entry of entries) {
    const key = budgetLineKeyFromEntry(entry);
    const current = totals.get(key) ?? 0;
    totals.set(key, roundCurrency(current + entry.budgeted_amount));
  }

  return totals;
}

type BuildBudgetVsActualReportParams = {
  viewMode: BudgetVsActualViewMode;
  budgets: BudgetRecord[];
  expenses: BudgetActualExpenseEntry[];
  rawMaterialPurchases: BudgetActualInventoryPurchaseEntry[];
  productPurchases: BudgetActualInventoryPurchaseEntry[];
  payrollRows: BudgetActualPayrollRow[];
  projects: ContractProjectOption[];
  year: number;
  month: number;
  monthIndex: number;
  projectFilter: string;
  /**
   * @internal Probe / regression only. Legacy behaviour that unions unbudgeted
   * spend into the row set (false "Over budget" alarms). Default false.
   */
  includeUnbudgetedActualRows?: boolean;
};

function collectActualLineKeys(params: {
  year: number;
  fromMonthIndex: number;
  throughMonthIndex: number;
  projectFilter: string;
  expenses: BudgetActualExpenseEntry[];
  budgetedSubsByCategory: Map<string, Set<string>>;
}): Set<string> {
  const keys = new Set<string>();

  for (const entry of params.expenses) {
    const monthIndex = getEntryMonthIndex(entry.date, params.year);
    if (
      monthIndex === null ||
      monthIndex < params.fromMonthIndex ||
      monthIndex > params.throughMonthIndex
    ) {
      continue;
    }

    if (!matchesProjectFilter(entry.project_id, params.projectFilter)) {
      continue;
    }

    const category = (entry.expense_category ?? "").trim();
    if (!category) {
      continue;
    }

    if (isInventoryPseudoCategory(category)) {
      keys.add(makeBudgetLineKey(category, null));
      continue;
    }

    const expenseSub = normalizeBudgetSubcategory(entry.sub_category);
    const budgetedSubs = params.budgetedSubsByCategory.get(category) ?? new Set();
    if (expenseSub && budgetedSubs.has(expenseSub)) {
      keys.add(makeBudgetLineKey(category, expenseSub));
    } else {
      keys.add(makeBudgetLineKey(category, null));
    }
  }

  keys.add(makeBudgetLineKey(BUDGET_ACTUAL_CATEGORY_RAW_MATERIALS, null));
  keys.add(makeBudgetLineKey(BUDGET_ACTUAL_CATEGORY_PURCHASED_INVENTORY, null));

  if (params.projectFilter !== ALL_PROJECTS_FILTER) {
    keys.add(makeBudgetLineKey(PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES, null));
  }

  return keys;
}

function resolveLineKeys(params: {
  budgetedByLineKey: Map<string, number>;
  includeUnbudgetedActualRows: boolean | undefined;
  year: number;
  fromMonthIndex: number;
  throughMonthIndex: number;
  projectFilter: string;
  expenses: BudgetActualExpenseEntry[];
  budgetedSubsByCategory: Map<string, Set<string>>;
}): Set<string> {
  if (!params.includeUnbudgetedActualRows) {
    return new Set<string>(params.budgetedByLineKey.keys());
  }

  return new Set<string>([
    ...params.budgetedByLineKey.keys(),
    ...collectActualLineKeys({
      year: params.year,
      fromMonthIndex: params.fromMonthIndex,
      throughMonthIndex: params.throughMonthIndex,
      projectFilter: params.projectFilter,
      expenses: params.expenses,
      budgetedSubsByCategory: params.budgetedSubsByCategory,
    }),
  ]);
}

function buildRowsForLineKeys(params: {
  lineKeys: Set<string>;
  budgetedByLineKey: Map<string, number>;
  budgetedSubsByCategory: Map<string, Set<string>>;
  rowKeySuffix: string;
  year: number;
  month: number;
  fromMonthIndex: number;
  throughMonthIndex: number;
  projectFilter: string;
  projects: ContractProjectOption[];
  expenses: BudgetActualExpenseEntry[];
  rawMaterialPurchases: BudgetActualInventoryPurchaseEntry[];
  productPurchases: BudgetActualInventoryPurchaseEntry[];
  payrollRows: BudgetActualPayrollRow[];
}): BudgetVsActualRow[] {
  return Array.from(params.lineKeys)
    .sort((left, right) => left.localeCompare(right))
    .map((lineKey) => {
      const { category, subcategory } = parseBudgetLineKey(lineKey);
      const budgeted = params.budgetedByLineKey.get(lineKey) ?? 0;
      const budgetedSubs =
        params.budgetedSubsByCategory.get(category) ?? new Set<string>();
      const actual = computeActualForLine({
        category,
        subcategory,
        budgetedSubs,
        year: params.year,
        month: params.month,
        fromMonthIndex: params.fromMonthIndex,
        throughMonthIndex: params.throughMonthIndex,
        projectFilter: params.projectFilter,
        projects: params.projects,
        expenses: params.expenses,
        rawMaterialPurchases: params.rawMaterialPurchases,
        productPurchases: params.productPurchases,
        payrollRows: params.payrollRows,
      });

      return buildReportRow({
        rowKey: `${lineKey}:${params.rowKeySuffix}`,
        category,
        subcategory,
        rowLabel: formatBudgetCategoryLabel(category, subcategory),
        budgeted,
        actual,
        countActualInTotals: true,
      });
    })
    .filter((row) => row.budgeted !== 0 || row.actual !== 0);
}

function buildMonthlyProratedReport(
  params: Omit<BuildBudgetVsActualReportParams, "viewMode">,
): BudgetVsActualRow[] {
  const periodMonth = `${params.year}-${String(params.month).padStart(2, "0")}-01`;
  const monthlyBudgets = monthlyBudgetsForExactMonth(
    params.budgets,
    periodMonth,
    params.projectFilter,
  );
  const annualBudgets = annualBudgetsForYear(
    params.budgets,
    params.year,
    params.projectFilter,
  );
  const budgetsInScope = [...monthlyBudgets, ...annualBudgets];
  const budgetedSubsByCategory = budgetedSubcategoriesByCategory(budgetsInScope);

  const budgetedByLineKey = new Map<string, number>();
  for (const entry of monthlyBudgets) {
    const key = budgetLineKeyFromEntry(entry);
    budgetedByLineKey.set(
      key,
      roundCurrency((budgetedByLineKey.get(key) ?? 0) + entry.budgeted_amount),
    );
  }
  for (const entry of annualBudgets) {
    const key = budgetLineKeyFromEntry(entry);
    budgetedByLineKey.set(
      key,
      roundCurrency((budgetedByLineKey.get(key) ?? 0) + entry.budgeted_amount / 12),
    );
  }

  // Budgeted lines only — unbudgeted spend must not create false "Over budget" rows
  // (unless includeUnbudgetedActualRows is set for legacy/probe comparison).
  const lineKeys = resolveLineKeys({
    budgetedByLineKey,
    includeUnbudgetedActualRows: params.includeUnbudgetedActualRows,
    year: params.year,
    fromMonthIndex: params.monthIndex,
    throughMonthIndex: params.monthIndex,
    projectFilter: params.projectFilter,
    expenses: params.expenses,
    budgetedSubsByCategory,
  });

  return buildRowsForLineKeys({
    lineKeys,
    budgetedByLineKey,
    budgetedSubsByCategory,
    rowKeySuffix: `prorated:${periodMonth}`,
    year: params.year,
    month: params.month,
    fromMonthIndex: params.monthIndex,
    throughMonthIndex: params.monthIndex,
    projectFilter: params.projectFilter,
    projects: params.projects,
    expenses: params.expenses,
    rawMaterialPurchases: params.rawMaterialPurchases,
    productPurchases: params.productPurchases,
    payrollRows: params.payrollRows,
  });
}

function buildMonthlyYtdReport(
  params: Omit<BuildBudgetVsActualReportParams, "viewMode">,
): BudgetVsActualRow[] {
  const monthlyThrough = monthlyBudgetsThroughMonth(
    params.budgets,
    params.year,
    params.month,
    params.projectFilter,
  );
  const annualBudgets = annualBudgetsForYear(
    params.budgets,
    params.year,
    params.projectFilter,
  );
  const budgetsInScope = [...monthlyThrough, ...annualBudgets];
  const budgetedSubsByCategory = budgetedSubcategoriesByCategory(budgetsInScope);

  const budgetedByLineKey = sumBudgetAmountsByLineKey(monthlyThrough);
  for (const entry of annualBudgets) {
    const key = budgetLineKeyFromEntry(entry);
    budgetedByLineKey.set(
      key,
      roundCurrency((budgetedByLineKey.get(key) ?? 0) + entry.budgeted_amount),
    );
  }

  // Budgeted lines only — unbudgeted spend must not create false "Over budget" rows
  // (unless includeUnbudgetedActualRows is set for legacy/probe comparison).
  const lineKeys = resolveLineKeys({
    budgetedByLineKey,
    includeUnbudgetedActualRows: params.includeUnbudgetedActualRows,
    year: params.year,
    fromMonthIndex: 0,
    throughMonthIndex: params.monthIndex,
    projectFilter: params.projectFilter,
    expenses: params.expenses,
    budgetedSubsByCategory,
  });

  return buildRowsForLineKeys({
    lineKeys,
    budgetedByLineKey,
    budgetedSubsByCategory,
    rowKeySuffix: `ytd:${params.year}-${params.month}`,
    year: params.year,
    month: params.month,
    fromMonthIndex: 0,
    throughMonthIndex: params.monthIndex,
    projectFilter: params.projectFilter,
    projects: params.projects,
    expenses: params.expenses,
    rawMaterialPurchases: params.rawMaterialPurchases,
    productPurchases: params.productPurchases,
    payrollRows: params.payrollRows,
  });
}

function buildAnnualViewReport(
  params: Omit<BuildBudgetVsActualReportParams, "viewMode" | "month" | "monthIndex">,
): BudgetVsActualRow[] {
  const throughMonthIndex = getAnnualActualThroughMonthIndex(params.year);
  if (throughMonthIndex < 0) {
    return [];
  }

  const monthlyInYear = allMonthlyBudgetsInYear(
    params.budgets,
    params.year,
    params.projectFilter,
  );
  const annualBudgets = annualBudgetsForYear(
    params.budgets,
    params.year,
    params.projectFilter,
  );
  const budgetsInScope = [...monthlyInYear, ...annualBudgets];
  const budgetedSubsByCategory = budgetedSubcategoriesByCategory(budgetsInScope);

  const budgetedByLineKey = sumBudgetAmountsByLineKey(monthlyInYear);
  for (const entry of annualBudgets) {
    const key = budgetLineKeyFromEntry(entry);
    budgetedByLineKey.set(
      key,
      roundCurrency((budgetedByLineKey.get(key) ?? 0) + entry.budgeted_amount),
    );
  }

  // Budgeted lines only — unbudgeted spend must not create false "Over budget" rows
  // (unless includeUnbudgetedActualRows is set for legacy/probe comparison).
  const lineKeys = resolveLineKeys({
    budgetedByLineKey,
    includeUnbudgetedActualRows: params.includeUnbudgetedActualRows,
    year: params.year,
    fromMonthIndex: 0,
    throughMonthIndex,
    projectFilter: params.projectFilter,
    expenses: params.expenses,
    budgetedSubsByCategory,
  });

  return buildRowsForLineKeys({
    lineKeys,
    budgetedByLineKey,
    budgetedSubsByCategory,
    rowKeySuffix: `annual:${params.year}`,
    year: params.year,
    month: throughMonthIndex + 1,
    fromMonthIndex: 0,
    throughMonthIndex,
    projectFilter: params.projectFilter,
    projects: params.projects,
    expenses: params.expenses,
    rawMaterialPurchases: params.rawMaterialPurchases,
    productPurchases: params.productPurchases,
    payrollRows: params.payrollRows,
  });
}

export function buildBudgetVsActualReport(
  params: BuildBudgetVsActualReportParams,
): BudgetVsActualRow[] {
  switch (params.viewMode) {
    case "monthly-prorated":
      return buildMonthlyProratedReport(params);
    case "monthly-ytd":
      return buildMonthlyYtdReport(params);
    case "annual":
      return buildAnnualViewReport(params);
  }
}

export function sumBudgetVsActualTotals(rows: BudgetVsActualRow[]): {
  budgeted: number;
  actual: number;
  variance: number;
  remaining: number;
} {
  // Rows are partitioned by (category, subcategory) with non-overlapping actuals,
  // so totals sum every counted row (do not collapse on category alone).
  const budgeted = roundCurrency(rows.reduce((sum, row) => sum + row.budgeted, 0));
  const actual = roundCurrency(
    rows.reduce(
      (sum, row) => (row.countActualInTotals ? sum + row.actual : sum),
      0,
    ),
  );
  const variance = roundCurrency(actual - budgeted);
  const remaining = roundCurrency(budgeted - actual);

  return { budgeted, actual, variance, remaining };
}

export function formatBudgetVsActualViewPeriodLabel(params: {
  viewMode: BudgetVsActualViewMode;
  year: number;
  month: number;
}): string {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  switch (params.viewMode) {
    case "monthly-prorated":
      return `${monthNames[params.month - 1]} ${params.year}`;
    case "monthly-ytd":
      return `Jan–${monthNames[params.month - 1]} ${params.year} (YTD)`;
    case "annual": {
      const throughMonthIndex = getAnnualActualThroughMonthIndex(params.year);
      if (throughMonthIndex < 0) {
        return `${params.year} (Annual)`;
      }

      if (throughMonthIndex === 11) {
        return `${params.year} (Full year)`;
      }

      return `${params.year} (Jan–${monthNames[throughMonthIndex]} YTD)`;
    }
  }
}
