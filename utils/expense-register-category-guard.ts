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

export function validateNewExpenseRegisterCategory(
  expenseCategory: string | null | undefined,
): string | null {
  if (isFixedAssetsExpenseCategory(expenseCategory)) {
    return EXPENSE_REGISTER_FIXED_ASSETS_REJECTION_MESSAGE;
  }
  return null;
}
