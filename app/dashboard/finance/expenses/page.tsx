import { cookies } from "next/headers";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";
import { mapApproverRows } from "../../approver-utils";
import type { Approver, NamedLookup } from "../../lookup-types";
import ExpenseRegister from "../expense-register";
import {
  normalizeExpenseRegisterEntry,
  queryExpenseSubcategoryLookups,
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
import { SUPPLIER_SELECT, type SupplierRow } from "@/utils/suppliers-types";
import {
  CONTRACT_PROJECT_SELECT,
  type ContractProjectOption,
} from "../../administration/projects-utils";

export default async function ExpensesPage() {
  const tenantId = await getCurrentUserTenantId();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data, error },
    { data: expenseCategories, error: expenseCategoriesError },
    { data: expenseSubcategories, error: expenseSubcategoriesError },
    { data: paymentMethods, error: paymentMethodsError },
    { data: approvers, error: approversError },
    { data: suppliers, error: suppliersError },
    { data: taxSettings, error: taxSettingsError },
    { data: taxRateCatalog, error: taxRateCatalogError },
    { data: projects, error: projectsError },
  ] = await Promise.all([
    supabase
      .from("expense_register")
      .select("*")
      .order("date", { ascending: false }),
    supabase
      .from("expense_categories")
      .select("name")
      .order("name", { ascending: true }),
    queryExpenseSubcategoryLookups(supabase),
    supabase.from("payment_methods").select("name").order("name", { ascending: true }),
    supabase
      .from("approvers")
      .select("employee_id, employees!approvers_employee_id_fkey(full_name)")
      .order("employee_id", { ascending: true }),
    tenantId
      ? supabase
          .from("suppliers")
          .select(SUPPLIER_SELECT)
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("tax_settings").select(TAX_SETTINGS_SELECT).limit(1).maybeSingle(),
    supabase
      .from("tax_rate_catalog")
      .select(TAX_RATE_CATALOG_SELECT)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    tenantId
      ? supabase
          .from("projects")
          .select(CONTRACT_PROJECT_SELECT)
          .eq("tenant_id", tenantId)
          .order("project_name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const fetchError =
    error?.message ??
    expenseCategoriesError?.message ??
    expenseSubcategoriesError?.message ??
    paymentMethodsError?.message ??
    approversError?.message ??
    suppliersError?.message ??
    taxSettingsError?.message ??
    taxRateCatalogError?.message ??
    projectsError?.message ??
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
        initialSuppliers={(suppliers as SupplierRow[] | null) ?? []}
        taxSettings={normalizeTaxSettings(taxSettings as TaxSettings | null)}
        taxRateCatalog={
          (taxRateCatalog as TaxRateCatalogEntry[] | null)?.map((entry) =>
            normalizeTaxRateCatalogEntry(entry),
          ) ?? []
        }
        initialProjects={(projects as ContractProjectOption[] | null) ?? []}
        fetchError={fetchError}
      />
    </div>
  );
}
