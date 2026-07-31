/** Preset category values still offered in the form dropdown. */
export type ExpensePresetCategory =
  | "insurance"
  | "property_tax"
  | "repairs"
  | "utilities"
  | "other";

/** Stored category is free text (presets or custom). */
export type ExpenseCategory = string;

export type ExpenseListRow = {
  expenseId: string;
  tenantId: string;
  propertyId: string;
  category: ExpenseCategory;
  amountGhs: number;
  expenseDate: string;
  description: string | null;
  receiptUrl: string | null;
};

export type ExpensePropertyOption = {
  propertyId: string;
  name: string;
};

export const CUSTOM_EXPENSE_CATEGORY_VALUE = "__custom__";

export const EXPENSE_CATEGORY_OPTIONS: Array<{
  value: ExpensePresetCategory;
  label: string;
}> = [
  { value: "insurance", label: "Insurance" },
  { value: "property_tax", label: "Property Tax" },
  { value: "repairs", label: "Repairs" },
  { value: "utilities", label: "Utilities" },
  { value: "other", label: "Other" },
];

export function isExpensePresetCategory(
  value: string,
): value is ExpensePresetCategory {
  return EXPENSE_CATEGORY_OPTIONS.some((option) => option.value === value);
}

export function formatExpenseCategory(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }
  const match = EXPENSE_CATEGORY_OPTIONS.find(
    (option) => option.value === value,
  );
  return match?.label ?? value;
}

export function formatExpenseMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) {
    return "—";
  }
  return `GHS ${Number(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatExpenseDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function sumExpenseAmounts(rows: ExpenseListRow[]): number {
  return Math.round(
    (rows.reduce((sum, row) => sum + (Number(row.amountGhs) || 0), 0) +
      Number.EPSILON) *
      100,
  ) / 100;
}

/** Unique categories from stored rows, sorted for filter dropdown. */
export function uniqueExpenseCategories(rows: ExpenseListRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const trimmed = row.category.trim();
    if (trimmed) {
      set.add(trimmed);
    }
  }
  return Array.from(set).sort((a, b) =>
    formatExpenseCategory(a).localeCompare(formatExpenseCategory(b), "en", {
      sensitivity: "base",
    }),
  );
}
