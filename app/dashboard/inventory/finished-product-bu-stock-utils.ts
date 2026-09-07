/**
 * BU-scoped finished-product stock overlay (Phase 7c.3).
 *
 * Master finished_products.current_stock is the tenant-wide total (sum of
 * balances). For a specific business / workspace default, overlay
 * finished_product_balances.current_stock onto the product list.
 *
 * All Businesses → stockMap null; callers keep master stock.
 * Default (NULL BU) → overlay; missing balance → current_stock 0 (catalog still listed).
 * Named unit → overlay balance stock when present; missing balance → current_stock 0.
 *   Catalog queries are BU-scoped on finished_products.business_unit_id, so tagged
 *   products must remain visible even before a balance row exists for that unit.
 *
 * finished_products has no master average_cost_per_unit column — WAC lives only
 * on finished_product_balances. overlayAverageCost is opt-in and never falls
 * back to a master WAC.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";

export type ScopedFinishedProductStockEntry = {
  current_stock: number;
  average_cost_per_unit: number;
};

export type ScopedFinishedProductStockResult = {
  /** null = All Businesses — caller keeps master current_stock. */
  stockMap: Map<string, ScopedFinishedProductStockEntry> | null;
  error: string | null;
};

export type MergeScopedFinishedProductStockOptions = {
  /**
   * When true, overlay average_cost_per_unit from the balance row.
   * - mode "unit": use balance WAC
   * - mode "default": use balance WAC when a row exists; otherwise null
   *   (no master fallback — finished_products has no WAC column)
   * Default false: leave average_cost_per_unit untouched (usually absent).
   */
  overlayAverageCost?: boolean;
};

const BALANCE_SELECT =
  "product_id, current_stock, average_cost_per_unit" as const;

export function scopedFinishedProductsQuery(
  supabase: SupabaseClient,
  buScope: BusinessUnitReadScope,
  select: string,
) {
  // Dynamic select strings lose Postgrest row inference; callers cast rows as needed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return applyBusinessUnitScope(
    supabase.from("finished_products").select(select),
    buScope,
  ) as any;
}

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
 * Apply scoped stock onto a finished-product catalog list.
 *
 * - stockMap null (All Businesses): return products unchanged (master stock).
 * - mode "default": overlay balance stock; missing balance → current_stock 0
 *   (still list every catalog product).
 * - mode "unit": overlay balance stock; missing balance → current_stock 0
 *   (catalog is already filtered by business_unit_id on finished_products).
 */
export function mergeScopedStockOntoProducts<
  T extends {
    id: string;
    current_stock: number;
    average_cost_per_unit?: number | null;
  },
>(
  products: T[],
  stockMap: Map<string, ScopedFinishedProductStockEntry> | null,
  _scopeMode: BusinessUnitReadScope["mode"] = "all",
  options?: MergeScopedFinishedProductStockOptions,
): T[] {
  if (stockMap == null) {
    return products;
  }

  const overlayAverageCost = options?.overlayAverageCost === true;

  return products.map((product) => {
    const entry = stockMap.get(product.id);
    return {
      ...product,
      current_stock: entry?.current_stock ?? 0,
      ...(overlayAverageCost
        ? {
            average_cost_per_unit: entry
              ? entry.average_cost_per_unit
              : null,
          }
        : {}),
    };
  });
}
