import { cookies } from "next/headers";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";
import { mapApproverRows } from "../../approver-utils";
import type { Approver, NamedLookup } from "../../lookup-types";
import FixedAssets from "../fixed-assets";
import type { FixedAssetEntry } from "../fixed-assets-utils";
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

export default async function FixedAssetsPage() {
  const tenantId = await getCurrentUserTenantId();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data, error },
    { data: assetCategories, error: assetCategoriesError },
    { data: depreciationMethods, error: depreciationMethodsError },
    { data: paymentMethods, error: paymentMethodsError },
    { data: approvers, error: approversError },
    { data: suppliers, error: suppliersError },
    { data: taxSettings, error: taxSettingsError },
    { data: taxRateCatalog, error: taxRateCatalogError },
    activeBusinessUnitId,
  ] = await Promise.all([
    supabase.from("fixed_assets").select("*").order("asset_id", { ascending: true }),
    supabase.from("asset_categories").select("name").order("name", { ascending: true }),
    supabase
      .from("depreciation_methods")
      .select("name")
      .order("name", { ascending: true }),
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
    getActiveBusinessUnitId(),
  ]);

  const fetchError =
    error?.message ??
    assetCategoriesError?.message ??
    depreciationMethodsError?.message ??
    paymentMethodsError?.message ??
    approversError?.message ??
    suppliersError?.message ??
    taxSettingsError?.message ??
    taxRateCatalogError?.message ??
    null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Fixed Assets
      </h2>
      <FixedAssets
        initialAssets={(data as FixedAssetEntry[] | null) ?? []}
        initialAssetCategories={(assetCategories as NamedLookup[] | null) ?? []}
        initialDepreciationMethods={
          (depreciationMethods as NamedLookup[] | null) ?? []
        }
        initialPaymentMethods={(paymentMethods as NamedLookup[] | null) ?? []}
        initialApprovers={mapApproverRows(approvers ?? []) as Approver[]}
        initialSuppliers={(suppliers as SupplierRow[] | null) ?? []}
        taxSettings={normalizeTaxSettings(taxSettings as TaxSettings | null)}
        taxRateCatalog={(taxRateCatalog ?? []).map((entry) =>
          normalizeTaxRateCatalogEntry(entry as TaxRateCatalogEntry),
        )}
        fetchError={fetchError}
        activeBusinessUnitId={activeBusinessUnitId}
      />
    </div>
  );
}
