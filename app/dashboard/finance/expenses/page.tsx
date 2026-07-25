import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { mapApproverRows } from "../../approver-utils";
import type { Approver, NamedLookup } from "../../lookup-types";
import ExpenseRegister from "../expense-register";
import {
  normalizeExpenseRegisterEntry,
  type ExpenseRegisterEntry,
} from "../expense-register-utils";
import FinanceNav from "../finance-nav";
import {
  normalizeTaxRateCatalogEntry,
  normalizeTaxSettings,
  TAX_RATE_CATALOG_SELECT,
  TAX_SETTINGS_SELECT,
  type TaxRateCatalogEntry,
  type TaxSettings,
} from "../tax-utils";

export default async function ExpensesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data, error },
    { data: expenseCategories, error: expenseCategoriesError },
    { data: expenseSubcategories, error: expenseSubcategoriesError },
    { data: paymentMethods, error: paymentMethodsError },
    { data: approvers, error: approversError },
    { data: taxSettings, error: taxSettingsError },
    { data: taxRateCatalog, error: taxRateCatalogError },
  ] = await Promise.all([
    supabase
      .from("expense_register")
      .select("*")
      .order("date", { ascending: false }),
    supabase
      .from("expense_categories")
      .select("name")
      .order("name", { ascending: true }),
    supabase
      .from("expense_subcategories")
      .select("name")
      .order("name", { ascending: true }),
    supabase.from("payment_methods").select("name").order("name", { ascending: true }),
    supabase
      .from("approvers")
      .select("employee_id, employees!approvers_employee_id_fkey(full_name)")
      .order("employee_id", { ascending: true }),
    supabase.from("tax_settings").select(TAX_SETTINGS_SELECT).limit(1).maybeSingle(),
    supabase
      .from("tax_rate_catalog")
      .select(TAX_RATE_CATALOG_SELECT)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ]);

  const fetchError =
    error?.message ??
    expenseCategoriesError?.message ??
    expenseSubcategoriesError?.message ??
    paymentMethodsError?.message ??
    approversError?.message ??
    taxSettingsError?.message ??
    taxRateCatalogError?.message ??
    null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Expense Register
      </h2>
      <ExpenseRegister
        initialEntries={
          (data as ExpenseRegisterEntry[] | null)?.map((entry) =>
            normalizeExpenseRegisterEntry(entry),
          ) ?? []
        }
        initialExpenseCategories={(expenseCategories as NamedLookup[] | null) ?? []}
        initialExpenseSubcategories={
          (expenseSubcategories as NamedLookup[] | null) ?? []
        }
        initialPaymentMethods={(paymentMethods as NamedLookup[] | null) ?? []}
        initialApprovers={mapApproverRows(approvers ?? []) as Approver[]}
        taxSettings={normalizeTaxSettings(taxSettings as TaxSettings | null)}
        taxRateCatalog={
          (taxRateCatalog as TaxRateCatalogEntry[] | null)?.map((entry) =>
            normalizeTaxRateCatalogEntry(entry),
          ) ?? []
        }
        fetchError={fetchError}
      />
    </div>
  );
}
