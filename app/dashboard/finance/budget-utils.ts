import { formatGHS } from "./income-register-utils";
import {
  buildPeriodMonth,
  getPeriodMonthParts,
} from "./cash-flow-utils";
import type { ContractProjectOption } from "../administration/projects-utils";

export type BudgetPeriodType = "monthly" | "annual";

export type BudgetRecord = {
  id: string;
  tenant_id: string;
  project_id: string | null;
  category: string;
  subcategory?: string | null;
  period_month: string;
  period_type: BudgetPeriodType;
  budgeted_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export const COMPANY_WIDE_PROJECT_VALUE = "__company_wide__";
export const WHOLE_CATEGORY_SUBCATEGORY_VALUE = "";

export type BudgetListPeriodTypeFilter = "all" | "monthly" | "annual";

export type BudgetFormState = {
  project_id: string;
  category: string;
  subcategory: string;
  budgeted_amount: string;
  notes: string;
  period_type: BudgetPeriodType;
  period_year: string;
  period_month: string;
};

export const emptyBudgetForm = (): BudgetFormState => ({
  project_id: COMPANY_WIDE_PROJECT_VALUE,
  category: "",
  subcategory: WHOLE_CATEGORY_SUBCATEGORY_VALUE,
  budgeted_amount: "",
  notes: "",
  period_type: "monthly",
  period_year: String(new Date().getFullYear()),
  period_month: String(new Date().getMonth() + 1),
});

const MONTH_NAMES = [
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
] as const;

export function normalizePeriodMonth(value: string): string {
  return value.slice(0, 10);
}

export function buildAnnualPeriodMonth(year: number): string {
  return `${year}-01-01`;
}

export function isAnnualBudget(entry: Pick<BudgetRecord, "period_type">): boolean {
  return entry.period_type === "annual";
}

export function formatPeriodMonthLabel(periodMonth: string): string {
  const parts = getPeriodMonthParts(periodMonth);
  if (!parts) {
    return periodMonth;
  }

  return `${MONTH_NAMES[parts.month - 1]} ${parts.year}`;
}

export function formatBudgetPeriodLabel(
  entry: Pick<BudgetRecord, "period_month" | "period_type">,
): string {
  if (isAnnualBudget(entry)) {
    const parts = getPeriodMonthParts(entry.period_month);
    return parts ? `${parts.year} (Annual)` : `${entry.period_month} (Annual)`;
  }

  return formatPeriodMonthLabel(entry.period_month);
}

export function resolveBudgetFormPeriodMonth(form: BudgetFormState): string {
  const year = Number(form.period_year);
  if (isAnnualBudget(form)) {
    return buildAnnualPeriodMonth(year);
  }

  return buildPeriodMonth(year, Number(form.period_month));
}

export function normalizeBudgetSubcategory(
  value: string | null | undefined,
): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export function resolveBudgetSubcategory(value: string): string | null {
  return normalizeBudgetSubcategory(value);
}

export function budgetFormSubcategoryValue(
  subcategory: string | null | undefined,
): string {
  return normalizeBudgetSubcategory(subcategory) ?? WHOLE_CATEGORY_SUBCATEGORY_VALUE;
}

/**
 * Matches unique index:
 * (tenant_id, COALESCE(project_id::text,''), category, COALESCE(subcategory,''), period_month, period_type)
 */
export function coalesceBudgetUniquePart(
  value: string | null | undefined,
): string {
  return value ?? "";
}

export function formatBudgetCategoryLabel(
  category: string,
  subcategory?: string | null,
): string {
  const sub = normalizeBudgetSubcategory(subcategory);
  return sub ? `${category} — ${sub}` : category;
}

export function normalizeBudgetRecord(raw: BudgetRecord): BudgetRecord {
  return {
    ...raw,
    period_type: raw.period_type === "annual" ? "annual" : "monthly",
    subcategory: normalizeBudgetSubcategory(raw.subcategory),
    budgeted_amount: Number(raw.budgeted_amount) || 0,
  };
}

export function resolveBudgetProjectId(value: string): string | null {
  return value === COMPANY_WIDE_PROJECT_VALUE ? null : value;
}

export function formatBudgetProjectLabel(
  projectId: string | null,
  projects: ContractProjectOption[],
): string {
  if (!projectId) {
    return "Company-wide";
  }

  const project = projects.find((entry) => entry.id === projectId);
  if (!project) {
    return "Unknown project";
  }

  return `${project.project_code} — ${project.project_name}`;
}

export function budgetFormProjectValue(projectId: string | null): string {
  return projectId ?? COMPANY_WIDE_PROJECT_VALUE;
}

export function findDuplicateBudget(
  entries: BudgetRecord[],
  candidate: {
    project_id: string | null;
    category: string;
    subcategory?: string | null;
    period_month: string;
    period_type: BudgetPeriodType;
  },
  excludeId?: string | null,
): BudgetRecord | null {
  const normalizedMonth = normalizePeriodMonth(candidate.period_month);
  const normalizedCategory = candidate.category.trim();
  const candidateProject = coalesceBudgetUniquePart(candidate.project_id);
  const candidateSubcategory = coalesceBudgetUniquePart(
    normalizeBudgetSubcategory(candidate.subcategory),
  );

  return (
    entries.find((entry) => {
      if (excludeId && entry.id === excludeId) {
        return false;
      }

      if (entry.period_type !== candidate.period_type) {
        return false;
      }

      if (normalizePeriodMonth(entry.period_month) !== normalizedMonth) {
        return false;
      }

      if (entry.category.trim() !== normalizedCategory) {
        return false;
      }

      if (
        coalesceBudgetUniquePart(entry.project_id) !== candidateProject
      ) {
        return false;
      }

      return (
        coalesceBudgetUniquePart(normalizeBudgetSubcategory(entry.subcategory)) ===
        candidateSubcategory
      );
    }) ?? null
  );
}

export function formatDuplicateBudgetMessage(
  duplicate: BudgetRecord,
  projects: ContractProjectOption[],
): string {
  return `A budget line already exists for ${formatBudgetProjectLabel(
    duplicate.project_id,
    projects,
  )}, ${formatBudgetCategoryLabel(duplicate.category, duplicate.subcategory)}, ${formatBudgetPeriodLabel(duplicate)}. Edit the existing line or change project, category, subcategory, period type, or period.`;
}

export function isBudgetDuplicateError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("duplicate key") ||
    normalized.includes("budgets_unique_period") ||
    normalized.includes("unique constraint")
  );
}

export function entryToBudgetForm(entry: BudgetRecord): BudgetFormState {
  const parts = getPeriodMonthParts(entry.period_month);
  return {
    project_id: budgetFormProjectValue(entry.project_id),
    category: entry.category,
    subcategory: budgetFormSubcategoryValue(entry.subcategory),
    budgeted_amount: String(entry.budgeted_amount ?? 0),
    notes: entry.notes?.trim() ?? "",
    period_type: entry.period_type,
    period_year: String(parts?.year ?? new Date().getFullYear()),
    period_month: String(parts?.month ?? new Date().getMonth() + 1),
  };
}

export function budgetEntriesForList(
  entries: BudgetRecord[],
  params: {
    year: number;
    month: number;
    periodTypeFilter: BudgetListPeriodTypeFilter;
  },
): BudgetRecord[] {
  const monthlyPeriod = buildPeriodMonth(params.year, params.month);
  const annualPeriod = buildAnnualPeriodMonth(params.year);

  return entries
    .filter((entry) => {
      const type = entry.period_type ?? "monthly";

      if (params.periodTypeFilter === "monthly") {
        return (
          type === "monthly" &&
          normalizePeriodMonth(entry.period_month) === monthlyPeriod
        );
      }

      if (params.periodTypeFilter === "annual") {
        return (
          type === "annual" &&
          normalizePeriodMonth(entry.period_month) === annualPeriod
        );
      }

      if (type === "monthly") {
        return normalizePeriodMonth(entry.period_month) === monthlyPeriod;
      }

      return normalizePeriodMonth(entry.period_month) === annualPeriod;
    })
    .sort((left, right) => {
      const leftType = left.period_type === "annual" ? 1 : 0;
      const rightType = right.period_type === "annual" ? 1 : 0;
      if (leftType !== rightType) {
        return leftType - rightType;
      }

      const leftProject = left.project_id ?? "";
      const rightProject = right.project_id ?? "";
      if (leftProject !== rightProject) {
        if (!left.project_id) {
          return -1;
        }
        if (!right.project_id) {
          return 1;
        }
        return leftProject.localeCompare(rightProject);
      }

      const categoryCompare = left.category.localeCompare(right.category);
      if (categoryCompare !== 0) {
        return categoryCompare;
      }

      const leftSub = coalesceBudgetUniquePart(
        normalizeBudgetSubcategory(left.subcategory),
      );
      const rightSub = coalesceBudgetUniquePart(
        normalizeBudgetSubcategory(right.subcategory),
      );
      return leftSub.localeCompare(rightSub);
    });
}

export { formatGHS, buildPeriodMonth, getPeriodMonthParts };
