import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getActiveBusinessUnitId } from "@/utils/dashboard-auth";
import type { NamedLookup } from "../../lookup-types";
import AccountsPayable from "../accounts-payable";
import {
  normalizeAccountsPayableEntry,
  type AccountsPayableEntry,
} from "../accounts-payable-utils";
import FinanceNav from "../finance-nav";
import { queryExpenseSubcategoryLookups } from "../expense-register-utils";
import {
  normalizeTaxRateCatalogEntry,
  normalizeTaxSettings,
  TAX_RATE_CATALOG_SELECT,
  TAX_SETTINGS_SELECT,
  type TaxRateCatalogEntry,
  type TaxSettings,
} from "../tax-utils";

export default async function AccountsPayablePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const activeBusinessUnitId = await getActiveBusinessUnitId();

  const [
    { data, error },
    { data: expenseCategories, error: expenseCategoriesError },
    { data: expenseSubcategories, error: expenseSubcategoriesError },
    { data: taxSettings, error: taxSettingsError },
    { data: taxRateCatalog, error: taxRateCatalogError },
  ] = await Promise.all([
    supabase
      .from("accounts_payable")
      .select("*")
      .order("due_date", { ascending: true }),
    supabase
      .from("expense_categories")
      .select("name")
      .order("name", { ascending: true }),
    queryExpenseSubcategoryLookups(supabase),
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
    taxSettingsError?.message ??
    taxRateCatalogError?.message ??
    null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Accounts Payable
      </h2>
      <AccountsPayable
        initialEntries={
          (data as AccountsPayableEntry[] | null)?.map((entry) =>
            normalizeAccountsPayableEntry(entry),
          ) ?? []
        }
        initialExpenseCategories={(expenseCategories as NamedLookup[] | null) ?? []}
        initialExpenseSubcategories={
          (expenseSubcategories as NamedLookup[] | null) ?? []
        }
        taxSettings={normalizeTaxSettings(taxSettings as TaxSettings | null)}
        taxRateCatalog={
          (taxRateCatalog as TaxRateCatalogEntry[] | null)?.map((entry) =>
            normalizeTaxRateCatalogEntry(entry),
          ) ?? []
        }
        fetchError={fetchError}
        activeBusinessUnitId={activeBusinessUnitId}
      />
    </div>
  );
}
