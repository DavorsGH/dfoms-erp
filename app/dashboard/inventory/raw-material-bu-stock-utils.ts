/**
 * BU-scoped raw-material stock overlay (Phase 7c.3).
 *
 * Master raw_materials.current_stock / average_cost_per_unit are tenant-wide.
 * For a specific business / workspace default, overlay from raw_material_balances.
 *
 * All Businesses → stockMap null; callers keep master values.
 * Default (NULL BU) → overlay; missing balance → current_stock 0 (catalog still listed).
 * Named unit → only materials with a balance row for that BU appear.
 *
 * Average cost overlay is opt-in (`overlayAverageCost`) so callers that still
 * cost/value from master WAC (production batches, stock-on-hand valuation) are
 * not silently changed. Raw Materials list display opts in.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";

export type ScopedRawMaterialStockEntry = {
  current_stock: number;
  average_cost_per_unit: number;
};

export type ScopedRawMaterialStockResult = {
  /** null = All Businesses — caller keeps master current_stock. */
  stockMap: Map<string, ScopedRawMaterialStockEntry> | null;
  error: string | null;
};

export type MergeScopedStockOptions = {
  /**
   * When true, also overlay average_cost_per_unit from the balance row.
   * - mode "unit": use balance WAC
   * - mode "default": use balance WAC when a row exists; otherwise null
   *   (do not fall back to master — avoids non-zero cost next to 0 stock)
   * Default false: leave master average_cost_per_unit untouched.
   */
  overlayAverageCost?: boolean;
};

const BALANCE_SELECT =
  "material_id, current_stock, average_cost_per_unit" as const;

/**
 * Load per-material stock for the active business-unit read scope.
 * - all → stockMap null (keep master)
 * - default → balances where business_unit_id IS NULL
 * - unit → balances for that business_unit_id
 */
export async function fetchScopedRawMaterialStock(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<ScopedRawMaterialStockResult> {
  if (buScope.mode === "all") {
    return { stockMap: null, error: null };
  }

  const { data, error } = await applyBusinessUnitScope(
    supabase
      .from("raw_material_balances")
      .select(BALANCE_SELECT)
      .eq("tenant_id", tenantId),
    buScope,
  );

  if (error) {
    return { stockMap: null, error: error.message };
  }

  const stockMap = new Map<string, ScopedRawMaterialStockEntry>();
  for (const row of (data as Array<{
    material_id: string;
    current_stock: number | string | null;
    average_cost_per_unit: number | string | null;
  }> | null) ?? []) {
    const materialId = String(row.material_id ?? "").trim();
    if (!materialId) continue;
    stockMap.set(materialId, {
      current_stock: Number(row.current_stock) || 0,
      average_cost_per_unit: Number(row.average_cost_per_unit) || 0,
    });
  }

  return { stockMap, error: null };
}

/**
 * Apply scoped stock onto a material catalog list.
 *
 * - stockMap null (All Businesses): return materials unchanged (master stock).
 * - mode "default": overlay balance stock; missing balance → current_stock 0
 *   (still list every catalog material).
 * - mode "unit": keep only materials that have a balance row for that BU;
 *   use that row's current_stock. Materials never allocated to the unit are
 *   omitted (not shown as 0 / false low-stock).
 *
 * Pass `{ overlayAverageCost: true }` to also overlay average_cost_per_unit
 * (Raw Materials list display). Leave off for production costing / valuation.
 */
export function mergeScopedStockOntoMaterials<
  T extends {
    id: string;
    current_stock: number;
    average_cost_per_unit?: number | null;
  },
>(
  materials: T[],
  stockMap: Map<string, ScopedRawMaterialStockEntry> | null,
  scopeMode: BusinessUnitReadScope["mode"] = "all",
  options?: MergeScopedStockOptions,
): T[] {
  if (stockMap == null) {
    return materials;
  }

  const overlayAverageCost = options?.overlayAverageCost === true;

  if (scopeMode === "unit") {
    const allocated: T[] = [];
    for (const material of materials) {
      const entry = stockMap.get(material.id);
      if (!entry) continue;
      allocated.push({
        ...material,
        current_stock: entry.current_stock,
        ...(overlayAverageCost
          ? { average_cost_per_unit: entry.average_cost_per_unit }
          : {}),
      });
    }
    return allocated;
  }

  return materials.map((material) => {
    const entry = stockMap.get(material.id);
    return {
      ...material,
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
