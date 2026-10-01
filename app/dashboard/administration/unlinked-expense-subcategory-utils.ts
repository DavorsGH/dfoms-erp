import {
  expenseSubcategoryNameKey,
  type ExpenseSubcategoryLookup,
} from "../finance/expense-register-utils";

export function linkedExpenseCategoriesForUnlinkedSubcategoryName(
  subcategoryName: string,
  allSubcategories: ExpenseSubcategoryLookup[],
): string[] {
  const nameKey = expenseSubcategoryNameKey(subcategoryName);
  if (!nameKey) {
    return [];
  }
  const categories = new Set<string>();
  for (const row of allSubcategories) {
    const category = (row.expense_category ?? "").trim();
    if (!category) {
      continue;
    }
    if (expenseSubcategoryNameKey(row.name) === nameKey) {
      categories.add(category);
    }
  }
  return [...categories].sort((left, right) => left.localeCompare(right));
}

export function isUnlinkedDuplicateOfLinkedSubcategory(
  unlinked: ExpenseSubcategoryLookup,
  allSubcategories: ExpenseSubcategoryLookup[],
): boolean {
  if ((unlinked.expense_category ?? "").trim()) {
    return false;
  }
  return (
    linkedExpenseCategoriesForUnlinkedSubcategoryName(
      unlinked.name,
      allSubcategories,
    ).length > 0
  );
}

export function formatUnlinkedDuplicateOfLabel(
  linkedCategories: string[],
): string {
  if (linkedCategories.length === 0) {
    return "";
  }
  return ` (duplicate of ${linkedCategories.join(", ")})`;
}

export function confirmRemoveUnlinkedDuplicateMessage(
  subName: string,
  linkedCategories: string[],
): string {
  return `'${subName}' already exists under ${linkedCategories.join(", ")}. Remove this unlinked duplicate?`;
}
