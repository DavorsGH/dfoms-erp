/**
 * BU-scoped finished-product stock overlay (Phase 7c.3).
 *
 * Master finished_products.current_stock is the tenant-wide total (sum of
 * balances). For a specific business / workspace default, overlay
 * finished_product_balances.current_stock onto the product list.
 *
 * All Businesses → stockMap null; callers keep master stock (correct aggregate;
 * POS checkout is already stamp-blocked in that mode).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";
import type { FinishedProductRecord } from "./finished-products-utils";

export type ScopedFinishedProductStockEntry = {
  current_stock: number;
  average_cost_per_unit: number;
};

export type ScopedFinishedProductStockResult = {
  /** null = All Businesses — caller keeps master current_stock. */
  stockMap: Map<string, ScopedFinishedProductStockEntry> | null;
  error: string | null;
};

const BALANCE_SELECT =
  "product_id, current_stock, average_cost_per_unit" as const;

/**
 * Load per-product stock for the active business-unit read scope.
 * - all → stockMap null (keep master)
 * - default → balances where business_unit_id IS NULL
 * - unit → balances for that business_unit_id
 */
export async function fetchScopedFinishedProductStock(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<ScopedFinishedProductStockResult> {
  if (buScope.mode === "all") {
    return { stockMap: null, error: null };
  }

  const { data, error } = await applyBusinessUnitScope(
    supabase
      .from("finished_product_balances")
      .select(BALANCE_SELECT)
      .eq("tenant_id", tenantId),
    buScope,
  );

  if (error) {
    return { stockMap: null, error: error.message };
  }

  const stockMap = new Map<string, ScopedFinishedProductStockEntry>();
  for (const row of (data as Array<{
    product_id: string;
    current_stock: number | string | null;
    average_cost_per_unit: number | string | null;
  }> | null) ?? []) {
    const productId = String(row.product_id ?? "").trim();
    if (!productId) continue;
    stockMap.set(productId, {
      current_stock: Number(row.current_stock) || 0,
      average_cost_per_unit: Number(row.average_cost_per_unit) || 0,
    });
  }

  return { stockMap, error: null };
}

/**
 * When stockMap is set, overwrite each product's current_stock from the map
 * (missing balance row → 0 for that BU). When null (All Businesses), return
 * products unchanged.
 */
export function mergeScopedStockOntoProducts(
  products: FinishedProductRecord[],
  stockMap: Map<string, ScopedFinishedProductStockEntry> | null,
): FinishedProductRecord[] {
  if (stockMap == null) {
    return products;
  }

  return products.map((product) => {
    const entry = stockMap.get(product.id);
    return {
      ...product,
      current_stock: entry?.current_stock ?? 0,
    };
  });
}
