import type { FinishedProductAverageCostRow } from "@/app/dashboard/inventory/inventory-balance-sheet-utils";

/**
 * TEMPORARY (Release 1 only — remove in Release 2 once migration 370 is on production).
 *
 * Tenants with no business_units rows treat NULL business_unit_id as the whole
 * business. Balance-sheet inventory uses tenant-wide average costs; when the
 * scoped DB function still returns 0, overlay NULL-BU balance WAC from storage.
 *
 * Release 2 checklist: delete this module and its use in balance-sheet-page-data.ts
 * after `370_inventory_bu_wac_hygiene.sql` is applied to production (single WAC source in DB).
 */
export function mergeZeroBuFinishedProductAverageCosts(
  tenantBusinessUnitCount: number,
  rpcAverages: FinishedProductAverageCostRow[],
  balanceRows: Array<{
    product_id: string;
    average_cost_per_unit: number | string | null;
    current_stock: number | string | null;
  }>,
): FinishedProductAverageCostRow[] {
  if (tenantBusinessUnitCount !== 0) {
    return rpcAverages;
  }

  const balanceWacByProduct = new Map<string, number>();
  for (const row of balanceRows) {
    const productId = String(row.product_id ?? "").trim();
    if (!productId) continue;
    const stock = Number(row.current_stock) || 0;
    const wac = Number(row.average_cost_per_unit) || 0;
    if (stock <= 0 || wac <= 0) continue;
    balanceWacByProduct.set(productId, wac);
  }

  if (balanceWacByProduct.size === 0) {
    return rpcAverages;
  }

  const merged = new Map<string, number>();
  for (const row of rpcAverages) {
    merged.set(row.product_id, Number(row.average_cost) || 0);
  }
  for (const [productId, wac] of balanceWacByProduct) {
    const existing = merged.get(productId) ?? 0;
    if (existing <= 0) {
      merged.set(productId, wac);
    }
  }

  return [...merged.entries()].map(([product_id, average_cost]) => ({
    product_id,
    average_cost,
  }));
}
