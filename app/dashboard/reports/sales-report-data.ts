import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  CRM_PRODUCT_SELECT,
  type CrmProductEntry,
} from "../crm/products/products-utils";

/** Includes unit_price, price_ghs, and fields needed for catalog price display. */
const PRODUCT_CATALOG_REPORT_SELECT = CRM_PRODUCT_SELECT;

export async function fetchProductCatalogReportData(
  supabase: SupabaseClient,
  buScope: BusinessUnitReadScope = { mode: "all" },
) {
  const { data, error } = await applyBusinessUnitScope(
    supabase.from("crm_products").select(PRODUCT_CATALOG_REPORT_SELECT),
    buScope,
  ).order("name", { ascending: true });

  return {
    initialProducts: (data as CrmProductEntry[] | null) ?? [],
    fetchError: error?.message ?? null,
  };
}
