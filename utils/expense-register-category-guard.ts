import { normalizeCategoryName } from "@/app/dashboard/finance/profit-loss-utils";

export const EXPENSE_REGISTER_FIXED_ASSETS_CATEGORY = "Fixed Assets";

export const EXPENSE_REGISTER_FIXED_ASSETS_REJECTION_MESSAGE =
  "Assets bought by the company are recorded in Finance → Fixed Assets, which also records the payment. Repairs and maintenance belong under an expense category such as Direct Operational.";

export function isFixedAssetsExpenseCategory(
  expenseCategory: string | null | undefined,
): boolean {
  return (
    normalizeCategoryName(expenseCategory ?? "") ===
    normalizeCategoryName(EXPENSE_REGISTER_FIXED_ASSETS_CATEGORY)
  );
}

export const EXPENSE_REGISTER_HIDDEN_CATEGORY_MESSAGE =
  "That expense category is hidden from new entries. Choose another category or show it again in Administration → Finance Settings → Expense Categories.";

export function validateNewExpenseRegisterCategory(
  expenseCategory: string | null | undefined,
  options?: {
    categoryRows?: Array<{ name: string; is_active?: boolean }>;
  },
): string | null {
  if (isFixedAssetsExpenseCategory(expenseCategory)) {
    return EXPENSE_REGISTER_FIXED_ASSETS_REJECTION_MESSAGE;
  }
  const key = normalizeCategoryName(expenseCategory ?? "");
  if (key && options?.categoryRows) {
    const row = options.categoryRows.find(
      (entry) => normalizeCategoryName(entry.name) === key,
    );
    if (row?.is_active === false) {
      return EXPENSE_REGISTER_HIDDEN_CATEGORY_MESSAGE;
    }
  }
  return null;
}

export const EXPENSE_REGISTER_HIDDEN_SUBCATEGORY_MESSAGE =
  "That sub-category is hidden from new entries. Choose another sub-category or show it again in Administration → Finance Settings → Expense Categories.";

export function validateNewExpenseRegisterSubcategory(
  expenseCategory: string | null | undefined,
  subCategory: string | null | undefined,
  subcategoryRows: Array<{
    name: string;
    expense_category: string | null;
    is_active?: boolean;
  }>,
  categoryRows?: Array<{ name: string; is_active?: boolean }>,
): string | null {
  const categoryKey = normalizeCategoryName(expenseCategory ?? "");
  const subKey = normalizeCategoryName(subCategory ?? "");
  if (!subKey) {
    return null;
  }
  if (categoryRows && categoryKey) {
    const categoryRow = categoryRows.find(
      (entry) => normalizeCategoryName(entry.name) === categoryKey,
    );
    if (categoryRow?.is_active === false) {
      return EXPENSE_REGISTER_HIDDEN_CATEGORY_MESSAGE;
    }
  }
  const row = subcategoryRows.find(
    (entry) =>
      normalizeCategoryName(entry.name) === subKey &&
      normalizeCategoryName(entry.expense_category ?? "") === categoryKey,
  );
  if (row?.is_active === false) {
    return EXPENSE_REGISTER_HIDDEN_SUBCATEGORY_MESSAGE;
  }
  return null;
}
