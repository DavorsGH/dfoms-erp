import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  CONTRACT_PROJECT_SELECT,
  type ContractProjectOption,
} from "../../administration/projects-utils";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import { scopeTaxSettingsRead } from "@/utils/phase5e-key-structure";
import type { NamedLookup } from "../../lookup-types";
import AccountsPayable from "../accounts-payable";
import {
  normalizeAccountsPayableEntry,
  type AccountsPayableEntry,
} from "../accounts-payable-utils";
import FinanceNav from "../finance-nav";
import {
  normalizeExpenseSubcategoryLookup,
  queryExpenseSubcategoryLookups,
} from "../expense-register-utils";
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
  const tenantId = await getCurrentUserTenantId();
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const [
    { data, error },
    { data: expenseCategories, error: expenseCategoriesError },
    { data: expenseSubcategories, error: expenseSubcategoriesError },
    { data: taxSettings, error: taxSettingsError },
    { data: taxRateCatalog, error: taxRateCatalogError },
    { data: projects, error: projectsError },
  ] = await Promise.all([
    applyBusinessUnitScope(
      supabase.from("accounts_payable").select("*"),
      buScope,
    ).order("due_date", { ascending: true }),
    supabase
      .from("expense_categories")
      .select("name, is_active")
      .order("name", { ascending: true }),
    queryExpenseSubcategoryLookups(supabase),
    scopeTaxSettingsRead(
      supabase.from("tax_settings").select(TAX_SETTINGS_SELECT),
      activeBusinessUnitId,
    ).maybeSingle(),
    supabase
      .from("tax_rate_catalog")
      .select(TAX_RATE_CATALOG_SELECT)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    tenantId
      ? applyBusinessUnitScope(
          supabase
            .from("projects")
            .select(CONTRACT_PROJECT_SELECT)
            .eq("tenant_id", tenantId),
          buScope,
        ).order("project_name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const fetchError =
    error?.message ??
    expenseCategoriesError?.message ??
    expenseSubcategoriesError?.message ??
    taxSettingsError?.message ??
    taxRateCatalogError?.message ??
    projectsError?.message ??
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
        initialExpenseSubcategories={(expenseSubcategories ?? []).map((row) =>
          normalizeExpenseSubcategoryLookup(row),
        )}
        taxSettings={normalizeTaxSettings(taxSettings as TaxSettings | null)}
        taxRateCatalog={
          (taxRateCatalog as TaxRateCatalogEntry[] | null)?.map((entry) =>
            normalizeTaxRateCatalogEntry(entry),
          ) ?? []
        }
        fetchError={fetchError}
        initialProjects={(projects as ContractProjectOption[] | null) ?? []}
        activeBusinessUnitId={activeBusinessUnitId}
      />
    </div>
  );
}
