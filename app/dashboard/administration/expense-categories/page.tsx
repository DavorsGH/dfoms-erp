import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import ExpenseCategorySettings from "../expense-category-settings";
import {
  EXPENSE_SUBCATEGORIES_LOOKUP_SELECT,
  type ExpenseSubcategoryLookup,
} from "../../finance/expense-register-utils";

export default async function ExpenseCategoriesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [categoriesResult, subcategoriesResult] = await Promise.all([
    supabase
      .from("expense_categories")
      .select("name, is_active")
      .order("name", { ascending: true }),
    supabase
      .from("expense_subcategories")
      .select(EXPENSE_SUBCATEGORIES_LOOKUP_SELECT)
      .order("expense_category", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  const fetchError =
    categoriesResult.error?.message ??
    subcategoriesResult.error?.message ??
    null;

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Expense Categories
      </h2>
      <ExpenseCategorySettings
        initialCategories={
          (categoriesResult.data as Array<{ name: string; is_active?: boolean }> | null) ??
          []
        }
        initialSubcategories={
          ((subcategoriesResult.data as ExpenseSubcategoryLookup[] | null) ?? []).map(
            (row) => ({
              id: String(row.id),
              name: row.name,
              expense_category: row.expense_category ?? null,
              is_active: row.is_active ?? true,
            }),
          )
        }
        fetchError={fetchError}
      />
    </>
  );
}
