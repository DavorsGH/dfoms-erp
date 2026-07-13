import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { NamedLookup } from "../../lookup-types";
import ExpenseCategories from "../expense-categories";

export default async function ExpenseCategoriesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("expense_categories")
    .select("name")
    .order("name", { ascending: true });

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Expense Categories
      </h2>
      <ExpenseCategories
        initialCategories={(data as NamedLookup[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
