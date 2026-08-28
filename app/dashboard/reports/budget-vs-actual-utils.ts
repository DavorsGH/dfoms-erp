import { PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES } from "../hr-payroll/payroll-lock-finance-utils";
import type { ContractProjectOption } from "../administration/projects-utils";
import {
  buildAnnualPeriodMonth,
  isAnnualBudget,
  normalizePeriodMonth,
  type BudgetRecord,
} from "../finance/budget-utils";
import { getPeriodMonthParts } from "../finance/cash-flow-utils";
import { getEntryMonthIndex } from "../finance/profit-loss-utils";

export type BudgetActualExpenseEntry = {
  date: string;
  expense_category: string | null;
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

function sumExpensesForCategoryInMonthRange(
  expenses: BudgetActualExpenseEntry[],
  category: string,
  year: number,
  fromMonthIndex: number,
  throughMonthIndex: number,
  projectFilter: string,
): number {
  return roundCurrency(
    expenses.reduce((sum, entry) => {
      if ((entry.expense_category ?? "").trim() !== category) {
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

function computeActualForCategory(params: {
  category: string;
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
    return sumInventoryPurchasesInMonthRange(
      rawMaterialPurchases,
      year,
      fromMonthIndex,
      throughMonthIndex,
      projectFilter,
    );
  }

  if (category === BUDGET_ACTUAL_CATEGORY_PURCHASED_INVENTORY) {
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
      return sumExpensesForCategoryInMonthRange(
        expenses,
        category,
        year,
        fromMonthIndex,
        throughMonthIndex,
        ALL_PROJECTS_FILTER,
      );
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

  return sumExpensesForCategoryInMonthRange(
    expenses,
    category,
    year,
    fromMonthIndex,
    throughMonthIndex,
    projectFilter,
  );
}

function collectActualCategories(params: {
  year: number;
  fromMonthIndex: number;
  throughMonthIndex: number;
  projectFilter: string;
  expenses: BudgetActualExpenseEntry[];
}): Set<string> {
  const categories = new Set<string>();

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
    if (category) {
      categories.add(category);
    }
  }

  categories.add(BUDGET_ACTUAL_CATEGORY_RAW_MATERIALS);
  categories.add(BUDGET_ACTUAL_CATEGORY_PURCHASED_INVENTORY);

  if (params.projectFilter !== ALL_PROJECTS_FILTER) {
    categories.add(PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES);
  }

  return categories;
}

function buildReportRow(params: {
  rowKey: string;
  category: string;
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

function sumBudgetAmountsByCategory(entries: BudgetRecord[]): Map<string, number> {
  const totals = new Map<string, number>();

  for (const entry of entries) {
    const current = totals.get(entry.category) ?? 0;
    totals.set(entry.category, roundCurrency(current + entry.budgeted_amount));
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
};

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

  const categories = new Set<string>([
    ...monthlyBudgets.map((entry) => entry.category),
    ...annualBudgets.map((entry) => entry.category),
    ...collectActualCategories({
      year: params.year,
      fromMonthIndex: params.monthIndex,
      throughMonthIndex: params.monthIndex,
      projectFilter: params.projectFilter,
      expenses: params.expenses,
    }),
  ]);

  const rows: BudgetVsActualRow[] = [];

  for (const category of Array.from(categories).sort((left, right) =>
    left.localeCompare(right),
  )) {
    const actual = computeActualForCategory({
      category,
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

    const monthlyTotal = monthlyBudgets
      .filter((entry) => entry.category === category)
      .reduce((sum, entry) => sum + entry.budgeted_amount, 0);

    const annualTotal = annualBudgets
      .filter((entry) => entry.category === category)
      .reduce((sum, entry) => sum + entry.budgeted_amount, 0);

    const budgeted = roundCurrency(monthlyTotal + annualTotal / 12);

    if (budgeted !== 0 || actual !== 0) {
      rows.push(
        buildReportRow({
          rowKey: `${category}:prorated:${periodMonth}`,
          category,
          rowLabel: category,
          budgeted,
          actual,
          countActualInTotals: true,
        }),
      );
    }
  }

  return rows.filter((row) => row.budgeted !== 0 || row.actual !== 0);
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

  const budgetedByCategory = sumBudgetAmountsByCategory(monthlyThrough);
  for (const entry of annualBudgets) {
    const current = budgetedByCategory.get(entry.category) ?? 0;
    budgetedByCategory.set(
      entry.category,
      roundCurrency(current + entry.budgeted_amount),
    );
  }

  const categories = new Set<string>([
    ...budgetedByCategory.keys(),
    ...collectActualCategories({
      year: params.year,
      fromMonthIndex: 0,
      throughMonthIndex: params.monthIndex,
      projectFilter: params.projectFilter,
      expenses: params.expenses,
    }),
  ]);

  return Array.from(categories)
    .sort((left, right) => left.localeCompare(right))
    .map((category) => {
      const budgeted = budgetedByCategory.get(category) ?? 0;
      const actual = computeActualForCategory({
        category,
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

      return buildReportRow({
        rowKey: `${category}:ytd:${params.year}-${params.month}`,
        category,
        rowLabel: category,
        budgeted,
        actual,
        countActualInTotals: true,
      });
    })
    .filter((row) => row.budgeted !== 0 || row.actual !== 0);
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

  const budgetedByCategory = sumBudgetAmountsByCategory(monthlyInYear);
  for (const entry of annualBudgets) {
    const current = budgetedByCategory.get(entry.category) ?? 0;
    budgetedByCategory.set(
      entry.category,
      roundCurrency(current + entry.budgeted_amount),
    );
  }

  const categories = new Set<string>([
    ...budgetedByCategory.keys(),
    ...collectActualCategories({
      year: params.year,
      fromMonthIndex: 0,
      throughMonthIndex,
      projectFilter: params.projectFilter,
      expenses: params.expenses,
    }),
  ]);

  return Array.from(categories)
    .sort((left, right) => left.localeCompare(right))
    .map((category) => {
      const budgeted = budgetedByCategory.get(category) ?? 0;
      const actual = computeActualForCategory({
        category,
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

      return buildReportRow({
        rowKey: `${category}:annual:${params.year}`,
        category,
        rowLabel: category,
        budgeted,
        actual,
        countActualInTotals: true,
      });
    })
    .filter((row) => row.budgeted !== 0 || row.actual !== 0);
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
  const actualByCategory = new Map<string, number>();

  for (const row of rows) {
    if (row.countActualInTotals) {
      actualByCategory.set(row.category, row.actual);
    }
  }

  const budgeted = roundCurrency(rows.reduce((sum, row) => sum + row.budgeted, 0));
  const actual = roundCurrency(
    Array.from(actualByCategory.values()).reduce((sum, value) => sum + value, 0),
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
