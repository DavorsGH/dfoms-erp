import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  CONTRACT_PROJECT_SELECT,
  type ContractProjectOption,
} from "../../administration/projects-utils";
import Budget from "../budget";
import FinanceNav from "../finance-nav";
import type { BudgetRecord } from "../budget-utils";
import type { NamedLookup } from "../../lookup-types";
import { queryExpenseSubcategoryLookups } from "../expense-register-utils";

export default async function BudgetPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const [
    { data: budgets, error: budgetsError },
    { data: expenseCategories, error: categoriesError },
    { data: expenseSubcategories, error: subcategoriesError },
    { data: projects, error: projectsError },
  ] = await Promise.all([
    supabase
      .from("budgets")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("period_month", { ascending: false })
      .order("category", { ascending: true }),
    supabase
      .from("expense_categories")
      .select("name")
      .order("name", { ascending: true }),
    queryExpenseSubcategoryLookups(supabase),
    supabase
      .from("projects")
      .select(CONTRACT_PROJECT_SELECT)
      .eq("tenant_id", tenantId)
      .order("project_name", { ascending: true }),
  ]);

  const fetchError =
    budgetsError?.message ??
    categoriesError?.message ??
    subcategoriesError?.message ??
    projectsError?.message ??
    null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Budget</h2>
      <Budget
        tenantId={tenantId}
        initialEntries={(budgets as BudgetRecord[] | null) ?? []}
        expenseCategories={(expenseCategories as NamedLookup[] | null) ?? []}
        expenseSubcategories={(expenseSubcategories as NamedLookup[] | null) ?? []}
        projects={(projects as ContractProjectOption[] | null) ?? []}
        fetchError={fetchError}
      />
    </div>
  );
}
