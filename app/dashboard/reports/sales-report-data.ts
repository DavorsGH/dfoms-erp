import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CRM_PRODUCT_SELECT,
  type CrmProductEntry,
} from "../crm/products/products-utils";

export async function fetchProductCatalogReportData(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("crm_products")
    .select(CRM_PRODUCT_SELECT)
    .order("name", { ascending: true });

  return {
    initialProducts: (data as CrmProductEntry[] | null) ?? [],
    fetchError: error?.message ?? null,
  };
}
