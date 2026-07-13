import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { NamedLookup } from "../../lookup-types";
import ExpenseSubcategories from "../expense-subcategories";

export default async function ExpenseSubcategoriesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("expense_subcategories")
    .select("name")
    .order("name", { ascending: true });

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Expense Sub-Categories
      </h2>
      <ExpenseSubcategories
        initialSubcategories={(data as NamedLookup[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
