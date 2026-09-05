/**
 * BU-scoped raw-material stock overlay (Phase 7c.3).
 *
 * Master raw_materials.current_stock is the tenant-wide total; for a specific
 * business / workspace default, overlay raw_material_balances.current_stock.
 *
 * All Businesses → stockMap null; callers keep master stock.
 * Default (NULL BU) → overlay; missing balance → 0 (catalog still listed).
 * Named unit → only materials with a balance row for that BU appear.
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
 */
export function mergeScopedStockOntoMaterials<
  T extends { id: string; current_stock: number },
>(
  materials: T[],
  stockMap: Map<string, ScopedRawMaterialStockEntry> | null,
  scopeMode: BusinessUnitReadScope["mode"] = "all",
): T[] {
  if (stockMap == null) {
    return materials;
  }

  if (scopeMode === "unit") {
    const allocated: T[] = [];
    for (const material of materials) {
      const entry = stockMap.get(material.id);
      if (!entry) continue;
      allocated.push({
        ...material,
        current_stock: entry.current_stock,
      });
    }
    return allocated;
  }

  return materials.map((material) => {
    const entry = stockMap.get(material.id);
    return {
      ...material,
      current_stock: entry?.current_stock ?? 0,
    };
  });
}
