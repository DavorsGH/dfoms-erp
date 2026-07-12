import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { NamedLookup } from "../../lookup-types";
import AccountsPayable from "../accounts-payable";
import type { AccountsPayableEntry } from "../accounts-payable-utils";
import FinanceNav from "../finance-nav";

export default async function AccountsPayablePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data, error },
    { data: expenseCategories, error: expenseCategoriesError },
    { data: expenseSubcategories, error: expenseSubcategoriesError },
  ] = await Promise.all([
    supabase
      .from("accounts_payable")
      .select("*")
      .order("due_date", { ascending: true }),
    supabase
      .from("expense_categories")
      .select("name")
      .order("name", { ascending: true }),
    supabase
      .from("expense_subcategories")
      .select("name")
      .order("name", { ascending: true }),
  ]);

  const fetchError =
    error?.message ??
    expenseCategoriesError?.message ??
    expenseSubcategoriesError?.message ??
    null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Accounts Payable
      </h2>
      <AccountsPayable
        initialEntries={(data as AccountsPayableEntry[] | null) ?? []}
        initialExpenseCategories={(expenseCategories as NamedLookup[] | null) ?? []}
        initialExpenseSubcategories={
          (expenseSubcategories as NamedLookup[] | null) ?? []
        }
        fetchError={fetchError}
      />
    </div>
  );
}
