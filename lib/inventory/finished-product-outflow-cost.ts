import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";
import { finishedProductNeedsOpeningCost } from "@/lib/inventory/finished-product-wac";

export type FinishedProductOutflowStatus = {
  /** Outflow unit cost for the selected business unit, keyed by product id. */
  outflowCostByProductId: Record<string, number>;
  /** Business unit names that still have stock and an outflow cost of 0 or less. */
  uncostedUnitNamesByProductId: Record<string, string[]>;
  error: string | null;
};

type BalanceRow = {
  product_id: string;
  business_unit_id: string | null;
  current_stock: number | string | null;
};

const CHUNK = 8;

async function mapInChunks<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += CHUNK) {
    const chunk = items.slice(index, index + CHUNK);
    results.push(...(await Promise.all(chunk.map(worker))));
  }
  return results;
}

/**
 * Unit cost from finished_product_inventory_outflow_unit_cost for every
 * balance that still has stock. The Finished Products badge and Set opening
 * cost both use this figure.
 */
export async function loadFinishedProductOutflowStatus(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<FinishedProductOutflowStatus> {
  let balanceQuery = supabase
    .from("finished_product_balances")
    .select("product_id, business_unit_id, current_stock")
    .eq("tenant_id", tenantId)
    .gt("current_stock", 0);
  if (buScope.mode !== "all") {
    balanceQuery = applyBusinessUnitScope(balanceQuery, buScope);
  }

  const [{ data: balances, error: balanceError }, { data: units, error: unitError }] =
    await Promise.all([
      balanceQuery,
      supabase.from("business_units").select("id, name").eq("tenant_id", tenantId),
    ]);

  if (balanceError) {
    return {
      outflowCostByProductId: {},
      uncostedUnitNamesByProductId: {},
      error: balanceError.message,
    };
  }
  if (unitError) {
    return {
      outflowCostByProductId: {},
      uncostedUnitNamesByProductId: {},
      error: unitError.message,
    };
  }

  const unitName = new Map<string, string>();
  for (const unit of (units as Array<{ id: string; name: string | null }> | null) ?? []) {
    unitName.set(unit.id, unit.name?.trim() || "Business unit");
  }

  const rows = ((balances as BalanceRow[] | null) ?? []).filter(
    (row) => (Number(row.current_stock) || 0) > 0 && row.product_id,
  );

  const measured = await mapInChunks(rows, async (row) => {
    const { data, error } = await supabase.rpc(
      "finished_product_inventory_outflow_unit_cost",
      {
        p_product_id: row.product_id,
        p_business_unit_id: row.business_unit_id,
      },
    );
    return {
      productId: row.product_id,
      businessUnitId: row.business_unit_id,
      stock: Number(row.current_stock) || 0,
      outflowCost: error ? null : Number(data),
      error: error?.message ?? null,
    };
  });

  const firstError = measured.find((row) => row.error)?.error ?? null;
  const outflowCostByProductId: Record<string, number> = {};
  const uncostedUnitNamesByProductId: Record<string, string[]> = {};

  for (const row of measured) {
    if (row.outflowCost == null || !Number.isFinite(row.outflowCost)) {
      continue;
    }
    if (buScope.mode !== "all") {
      outflowCostByProductId[row.productId] = row.outflowCost;
    }
    if (!finishedProductNeedsOpeningCost(row.stock, row.outflowCost)) {
      continue;
    }
    const name = row.businessUnitId
      ? (unitName.get(row.businessUnitId) ?? "Business unit")
      : "No business unit";
    const names = uncostedUnitNamesByProductId[row.productId] ?? [];
    if (!names.includes(name)) {
      names.push(name);
    }
    uncostedUnitNamesByProductId[row.productId] = names;
  }

  return {
    outflowCostByProductId,
    uncostedUnitNamesByProductId,
    error: firstError,
  };
}
