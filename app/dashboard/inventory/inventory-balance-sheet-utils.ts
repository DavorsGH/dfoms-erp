import type { InventoryStockAdjustmentRow } from "@/lib/inventory/inventory-stock-adjustment-financials";
import type { FinishedProductRecord } from "./finished-products-utils";
import type { RawMaterialRecord } from "./raw-materials-utils";
import {
  addAmountToMonth,
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  getEntryMonthIndex,
  type MonthlyTotals,
} from "../finance/profit-loss-utils";
import { getMonthEndDate } from "../finance/capital-contributions-utils";

function roundInventoryCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export const INTERNAL_CONSUMPTION_EXPENSE_CATEGORY = "Direct Operational";
export const INTERNAL_CONSUMPTION_EXPENSE_SUB_CATEGORY =
  "Finished Goods - Internal Use";
export const INTERNAL_CONSUMPTION_PAYMENT_STATUS = "Non-Cash";
export const RAW_MATERIAL_AP_EXPENSE_CATEGORY = "Direct Operational";
export const RAW_MATERIAL_AP_SUB_CATEGORY = "Raw Materials";

export type InventoryBalanceConfig = {
  go_live_date: string;
  opening_inventory_value: number;
  created_at: string;
};

export type RawMaterialPurchaseCashEntry = {
  purchase_date: string;
  total_cost: number;
  payment_method: string;
  created_at: string;
};

/** Finished-product cost inflow (production batch or product purchase). */
export type FinishedProductInventoryInflow = {
  product_id: string;
  source: "production" | "purchase";
  /** Business date: production_date or purchase_date. */
  event_date: string;
  created_at: string;
  total_cost: number;
};

/**
 * Product-sale COGS (and reversals) attributed to finished-product carrying value.
 * Matches finished_product_weighted_avg_cost / script 145: sum of linked expense amounts.
 */
export type FinishedProductInventoryCogs = {
  product_id: string;
  sale_date: string;
  cogs_amount: number;
};

/**
 * Internal-consumption expense linked to finished-product carrying value.
 * Matches finished_product_weighted_avg_cost / script 241: sum of linked expense amounts.
 */
export type FinishedProductInventoryInternalUse = {
  product_id: string;
  consumption_date: string;
  amount: number;
};

/** Raw-material purchase lot for point-in-time qty/WAC reconstruction. */
export type RawMaterialInventoryPurchase = {
  material_id: string;
  purchase_date: string;
  created_at: string;
  quantity: number;
  cost_per_unit: number;
};

/** Raw material used in a production batch (consumption date = batch production_date). */
export type RawMaterialInventoryConsumption = {
  material_id: string;
  consumption_date: string;
  quantity_used: number;
};

export type RawMaterialInventoryAdjustment = {
  material_id: string;
  effective_date: string;
  quantity_delta: number;
  cost_per_unit: number;
};

/** Finished-product manual stock adjustment (found stock, opening balance, etc.). */
export type FinishedProductInventoryAdjustment = {
  product_id: string;
  effective_date: string;
  quantity_delta: number;
  cost_per_unit: number;
};

export type InventoryValuationHistory = {
  finishedProductInflows: FinishedProductInventoryInflow[];
  finishedProductCogs: FinishedProductInventoryCogs[];
  finishedProductInternalUse: FinishedProductInventoryInternalUse[];
  finishedProductAdjustments?: FinishedProductInventoryAdjustment[];
  rawMaterialPurchases: RawMaterialInventoryPurchase[];
  rawMaterialConsumptions: RawMaterialInventoryConsumption[];
  rawMaterialAdjustments?: RawMaterialInventoryAdjustment[];
};

export function normalizePaymentMethod(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\u2013|\u2014/g, "-");
}

/** Mirrors expense-register cash vs on-account split using payment method naming. */
export function isCreditPaymentMethod(
  paymentMethod: string | null | undefined,
): boolean {
  const normalized = normalizePaymentMethod(paymentMethod);
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("credit") ||
    normalized.includes("on account") ||
    normalized.includes("on-account") ||
    normalized.includes("accounts payable") ||
    normalized.includes("supplier credit")
  );
}

export function isCashPaymentMethod(
  paymentMethod: string | null | undefined,
): boolean {
  return !isCreditPaymentMethod(paymentMethod);
}

/**
 * Row shape returned by get_finished_product_average_costs(p_tenant_id).
 * Tenant-scoped in the database (script 130); callers must pass tenant_id.
 */
export type FinishedProductAverageCostRow = {
  product_id: string;
  average_cost: number;
};

export function buildAverageFinishedProductCostMap(
  averageCosts: FinishedProductAverageCostRow[],
): Map<string, number> {
  const averages = new Map<string, number>();

  for (const row of averageCosts) {
    averages.set(row.product_id, Number(row.average_cost) || 0);
  }

  return averages;
}

export function calculateTotalInventoryValue(
  rawMaterials: Array<Pick<RawMaterialRecord, "current_stock" | "average_cost_per_unit">>,
  finishedProducts: Array<Pick<FinishedProductRecord, "id" | "current_stock">>,
  finishedProductAverageCosts: FinishedProductAverageCostRow[],
): number {
  const finishedAverageCosts = buildAverageFinishedProductCostMap(
    finishedProductAverageCosts,
  );

  const rawTotal = rawMaterials.reduce((sum, material) => {
    const stock = Number(material.current_stock) || 0;
    const cost = Number(material.average_cost_per_unit) || 0;
    return sum + stock * cost;
  }, 0);

  const finishedTotal = finishedProducts.reduce((sum, product) => {
    const stock = Number(product.current_stock) || 0;
    const cost = finishedAverageCosts.get(product.id) ?? 0;
    return sum + stock * cost;
  }, 0);

  return roundInventoryCurrency(rawTotal + finishedTotal);
}

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

function isOnOrAfterGoLive(
  entryDate: string,
  goLiveDate: string | null | undefined,
): boolean {
  if (!goLiveDate) {
    return false;
  }

  return normalizeDate(entryDate) >= normalizeDate(goLiveDate);
}

/**
 * Inventory purchases activated after go-live participate in Balance Sheet cash
 * and valuation even when purchase_date was backdated before go-live.
 */
export function getActivatedInventoryPurchaseEffectiveDate(
  purchase: { purchase_date: string; created_at: string },
  config: InventoryBalanceConfig | null,
): string | null {
  if (!config?.go_live_date || !isActivatedPurchase(purchase.created_at, config)) {
    return null;
  }

  const goLiveDate = normalizeDate(config.go_live_date);
  const purchaseDate = normalizeDate(purchase.purchase_date);
  return purchaseDate >= goLiveDate ? purchaseDate : goLiveDate;
}

function isActivatedPurchase(
  purchaseCreatedAt: string,
  config: InventoryBalanceConfig | null,
): boolean {
  if (!config?.created_at) {
    return false;
  }

  return (
    new Date(purchaseCreatedAt).getTime() >=
    new Date(config.created_at).getTime()
  );
}

/**
 * Effective business date for a finished-product cost inflow.
 * Production batches use production_date (clamped to go-live).
 * Product purchases use the same activation/effective-date rules as cash outflows.
 */
export function getFinishedProductInflowEffectiveDate(
  inflow: Pick<FinishedProductInventoryInflow, "event_date" | "created_at">,
  config: InventoryBalanceConfig | null,
  kind: "production" | "purchase",
): string | null {
  if (!config?.go_live_date) {
    return null;
  }

  if (kind === "purchase") {
    return getActivatedInventoryPurchaseEffectiveDate(
      { purchase_date: inflow.event_date, created_at: inflow.created_at },
      config,
    );
  }

  const goLiveDate = normalizeDate(config.go_live_date);
  const eventDate = normalizeDate(inflow.event_date);
  if (eventDate < goLiveDate) {
    return null;
  }
  return eventDate;
}

function getRawMaterialPurchaseEffectiveDate(
  purchase: Pick<RawMaterialInventoryPurchase, "purchase_date" | "created_at">,
  config: InventoryBalanceConfig | null,
): string | null {
  return getActivatedInventoryPurchaseEffectiveDate(
    {
      purchase_date: purchase.purchase_date,
      created_at: purchase.created_at,
    },
    config,
  );
}

/**
 * Finished-product carrying value as of asOfDate (inclusive), matching script 145/241
 * on-hand WAC identity: (production + purchases − booked COGS − internal use) at that date.
 */
export function calculateFinishedProductValueAsOf(
  inflows: FinishedProductInventoryInflow[],
  cogs: FinishedProductInventoryCogs[],
  internalUse: FinishedProductInventoryInternalUse[],
  config: InventoryBalanceConfig | null,
  asOfDate: string,
  adjustments: FinishedProductInventoryAdjustment[] = [],
): number {
  if (!config?.go_live_date) {
    return 0;
  }

  const asOf = normalizeDate(asOfDate);
  const goLive = normalizeDate(config.go_live_date);
  const productIds = new Set<string>();
  for (const inflow of inflows) {
    productIds.add(inflow.product_id);
  }
  for (const row of cogs) {
    productIds.add(row.product_id);
  }
  for (const row of internalUse) {
    productIds.add(row.product_id);
  }
  for (const row of adjustments) {
    productIds.add(row.product_id);
  }

  let total = 0;
  for (const productId of productIds) {
    let value = 0;

    for (const inflow of inflows) {
      if (inflow.product_id !== productId) {
        continue;
      }
      const effective = getFinishedProductInflowEffectiveDate(
        inflow,
        config,
        inflow.source,
      );
      if (!effective || effective > asOf) {
        continue;
      }
      value += Number(inflow.total_cost) || 0;
    }

    for (const row of cogs) {
      if (row.product_id !== productId) {
        continue;
      }
      const saleDate = normalizeDate(row.sale_date);
      if (saleDate > asOf) {
        continue;
      }
      value -= Number(row.cogs_amount) || 0;
    }

    for (const row of internalUse) {
      if (row.product_id !== productId) {
        continue;
      }
      const consumptionDate = normalizeDate(row.consumption_date);
      if (consumptionDate > asOf) {
        continue;
      }
      value -= Number(row.amount) || 0;
    }

    for (const adjustment of adjustments) {
      if (adjustment.product_id !== productId) {
        continue;
      }
      const effective = normalizeDate(adjustment.effective_date);
      if (!effective || effective < goLive || effective > asOf) {
        continue;
      }
      const qty = Number(adjustment.quantity_delta) || 0;
      const unit = Number(adjustment.cost_per_unit) || 0;
      if (qty === 0) {
        continue;
      }
      value += qty * unit;
    }

    total += value;
  }

  return roundInventoryCurrency(total);
}

type RawMaterialValuationEvent =
  | {
      kind: "purchase";
      material_id: string;
      sort_date: string;
      qty: number;
      total_cost: number;
    }
  | {
      kind: "adjustment";
      material_id: string;
      sort_date: string;
      qty: number;
      total_cost: number;
    }
  | {
      kind: "consumption";
      material_id: string;
      sort_date: string;
      qty: number;
    };

function applyRawMaterialBalanceInflow(
  stock: number,
  avg: number,
  qty: number,
  totalCost: number,
): { stock: number; avg: number } {
  if (qty === 0) {
    return { stock, avg };
  }
  const oldValue = stock * avg;
  const newStock = stock + qty;
  if (newStock <= 0) {
    return { stock: newStock, avg: 0 };
  }
  const newAvg = (oldValue + totalCost) / newStock;
  return { stock: newStock, avg: newAvg };
}

/**
 * Raw-material carrying value as of asOfDate, simulated from purchases,
 * stock adjustments, and production consumption in chronological order.
 * Matches raw_material_balances WAC rules (consumption changes qty only).
 */
export function calculateRawMaterialValueAsOf(
  purchases: RawMaterialInventoryPurchase[],
  consumptions: RawMaterialInventoryConsumption[],
  config: InventoryBalanceConfig | null,
  asOfDate: string,
  adjustments: RawMaterialInventoryAdjustment[] = [],
): number {
  if (!config?.go_live_date) {
    return 0;
  }

  const asOf = normalizeDate(asOfDate);
  const goLive = normalizeDate(config.go_live_date);
  const events: RawMaterialValuationEvent[] = [];

  for (const purchase of purchases) {
    const effective = getRawMaterialPurchaseEffectiveDate(purchase, config);
    if (!effective || effective > asOf) {
      continue;
    }
    const qty = Number(purchase.quantity) || 0;
    const unit = Number(purchase.cost_per_unit) || 0;
    if (qty === 0) {
      continue;
    }
    events.push({
      kind: "purchase",
      material_id: purchase.material_id,
      sort_date: effective,
      qty,
      total_cost: qty * unit,
    });
  }

  for (const adjustment of adjustments) {
    const effective = normalizeDate(adjustment.effective_date);
    if (!effective || effective < goLive || effective > asOf) {
      continue;
    }
    const qty = Number(adjustment.quantity_delta) || 0;
    const unit = Number(adjustment.cost_per_unit) || 0;
    if (qty === 0) {
      continue;
    }
    events.push({
      kind: "adjustment",
      material_id: adjustment.material_id,
      sort_date: effective,
      qty,
      total_cost: qty * unit,
    });
  }

  for (const consumption of consumptions) {
    const consumedOn = normalizeDate(consumption.consumption_date);
    if (consumedOn < goLive || consumedOn > asOf) {
      continue;
    }
    const qty = Number(consumption.quantity_used) || 0;
    if (qty === 0) {
      continue;
    }
    events.push({
      kind: "consumption",
      material_id: consumption.material_id,
      sort_date: consumedOn,
      qty,
    });
  }

  events.sort((a, b) => {
    const byDate = a.sort_date.localeCompare(b.sort_date);
    if (byDate !== 0) {
      return byDate;
    }
    const order = { purchase: 0, adjustment: 1, consumption: 2 } as const;
    return order[a.kind] - order[b.kind];
  });

  const state = new Map<string, { stock: number; avg: number }>();

  function materialState(materialId: string) {
    let row = state.get(materialId);
    if (!row) {
      row = { stock: 0, avg: 0 };
      state.set(materialId, row);
    }
    return row;
  }

  for (const event of events) {
    const row = materialState(event.material_id);
    if (event.kind === "consumption") {
      row.stock -= event.qty;
      continue;
    }
    const next = applyRawMaterialBalanceInflow(
      row.stock,
      row.avg,
      event.qty,
      event.total_cost,
    );
    row.stock = next.stock;
    row.avg = next.avg;
  }

  let total = 0;
  for (const row of state.values()) {
    if (row.stock <= 0) {
      continue;
    }
    total += row.stock * row.avg;
  }

  return roundInventoryCurrency(Math.max(total, 0));
}

export function calculateInventoryValueAsOf(
  history: InventoryValuationHistory,
  config: InventoryBalanceConfig | null,
  asOfDate: string,
): number {
  return roundInventoryCurrency(
    calculateFinishedProductValueAsOf(
      history.finishedProductInflows,
      history.finishedProductCogs,
      history.finishedProductInternalUse,
      config,
      asOfDate,
      history.finishedProductAdjustments ?? [],
    ) +
      calculateRawMaterialValueAsOf(
        history.rawMaterialPurchases,
        history.rawMaterialConsumptions,
        config,
        asOfDate,
        history.rawMaterialAdjustments ?? [],
      ),
  );
}

/**
 * Month-aware inventory asset series.
 *
 * Each month-end (clamped to referenceDate for the current month) is valued from
 * purchase / production / COGS / consumption history up to that date — not from
 * painting live current_stock across the FY.
 *
 * Go-live month only: add config.opening_inventory_value to the asset so it
 * matches Inventory Opening Balance equity (pre–go-live stock not in history).
 * Applied after carry-forward so future months never inherit the opening bump.
 *
 * Months after the reference month carry forward the current-month value (same
 * FY projection behaviour as commit 2aa961e — do not zero future months while
 * equity/AR lines remain populated).
 *
 * FULL_YEAR uses the December snapshot.
 */
export function calculateInventoryByMonth(
  history: InventoryValuationHistory,
  config: InventoryBalanceConfig | null,
  financialYear: number,
  referenceDate = new Date(),
  _stockAdjustments: InventoryStockAdjustmentRow[] = [],
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  if (!config?.go_live_date) {
    return totals;
  }

  const goLiveMonthIndex = getEntryMonthIndex(config.go_live_date, financialYear);
  if (goLiveMonthIndex === null) {
    return totals;
  }

  const referenceDateOnly = normalizeDate(referenceDate.toISOString());
  const currentMonthIndex = getEntryMonthIndex(referenceDateOnly, financialYear);

  for (let monthIndex = goLiveMonthIndex; monthIndex < 12; monthIndex += 1) {
    if (currentMonthIndex !== null && monthIndex > currentMonthIndex) {
      // Carry forward — filled after the loop.
      continue;
    }

    const monthEnd = getMonthEndDate(financialYear, monthIndex + 1);
    const asOf =
      currentMonthIndex !== null && monthIndex === currentMonthIndex
        ? referenceDateOnly < monthEnd
          ? referenceDateOnly
          : monthEnd
        : monthEnd;

    totals[monthIndex] = calculateInventoryValueAsOf(history, config, asOf);
  }

  if (currentMonthIndex !== null) {
    const carry = totals[currentMonthIndex] ?? 0;
    for (let monthIndex = currentMonthIndex + 1; monthIndex < 12; monthIndex += 1) {
      if (monthIndex >= goLiveMonthIndex) {
        totals[monthIndex] = carry;
      }
    }
  }

  // Match calculateInventoryOpeningEquityByMonth: same go-live month index.
  // Add after carry-forward so opening never leaks into later months.
  const openingInventoryValue =
    Number(config.opening_inventory_value) || 0;
  if (openingInventoryValue !== 0) {
    totals[goLiveMonthIndex] = roundInventoryCurrency(
      (totals[goLiveMonthIndex] ?? 0) + openingInventoryValue,
    );
  }

  // Stock adjustments are included in movement history (FP + RM). P&L overlay
  // still uses stockAdjustments separately in balance-sheet-utils.

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

/** @deprecated Prefer calculateInventoryByMonth(history, …) — live snapshot helper. */
export function calculateInventoryByMonthFromLiveStock(
  rawMaterials: Array<Pick<RawMaterialRecord, "current_stock" | "average_cost_per_unit">>,
  finishedProducts: Array<Pick<FinishedProductRecord, "id" | "current_stock">>,
  finishedProductAverageCosts: FinishedProductAverageCostRow[],
  config: InventoryBalanceConfig | null,
  financialYear: number,
  referenceDate = new Date(),
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  if (!config?.go_live_date) {
    return totals;
  }

  const goLiveMonthIndex = getEntryMonthIndex(config.go_live_date, financialYear);
  if (goLiveMonthIndex === null) {
    return totals;
  }

  const liveValue = calculateTotalInventoryValue(
    rawMaterials,
    finishedProducts,
    finishedProductAverageCosts,
  );

  const referenceDateOnly = normalizeDate(referenceDate.toISOString());
  const currentMonthIndex = getEntryMonthIndex(referenceDateOnly, financialYear);

  for (let monthIndex = goLiveMonthIndex; monthIndex < 12; monthIndex += 1) {
    if (currentMonthIndex !== null && monthIndex > currentMonthIndex) {
      continue;
    }
    totals[monthIndex] = liveValue;
  }

  if (currentMonthIndex !== null) {
    const carry = totals[currentMonthIndex] ?? 0;
    for (let monthIndex = currentMonthIndex + 1; monthIndex < 12; monthIndex += 1) {
      if (monthIndex >= goLiveMonthIndex) {
        totals[monthIndex] = carry;
      }
    }
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

export function calculateInventoryOpeningEquityByMonth(
  config: InventoryBalanceConfig | null,
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  if (!config?.go_live_date || !config.opening_inventory_value) {
    return totals;
  }

  const monthIndex = getEntryMonthIndex(config.go_live_date, financialYear);
  if (monthIndex === null) {
    return totals;
  }

  totals[monthIndex] = roundInventoryCurrency(
    Number(config.opening_inventory_value) || 0,
  );
  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

/** Same row shape as RawMaterialPurchaseCashEntry, read from product_purchases. */
export type ProductPurchaseCashEntry = RawMaterialPurchaseCashEntry;

function calculateInventoryPurchaseCashOutflowsByMonth(
  purchases: RawMaterialPurchaseCashEntry[],
  config: InventoryBalanceConfig | null,
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  if (!config?.go_live_date) {
    return totals;
  }

  for (const purchase of purchases) {
    const effectiveDate = getActivatedInventoryPurchaseEffectiveDate(
      purchase,
      config,
    );
    if (!effectiveDate) {
      continue;
    }

    if (!isCashPaymentMethod(purchase.payment_method)) {
      continue;
    }

    const monthIndex = getEntryMonthIndex(effectiveDate, financialYear);
    if (monthIndex === null) {
      continue;
    }

    addAmountToMonth(totals, monthIndex, Number(purchase.total_cost) || 0);
  }

  return totals.map((value) => roundInventoryCurrency(value)) as MonthlyTotals;
}

export function calculateRawMaterialPurchaseCashOutflowsByMonth(
  purchases: RawMaterialPurchaseCashEntry[],
  config: InventoryBalanceConfig | null,
  financialYear: number,
): MonthlyTotals {
  return calculateInventoryPurchaseCashOutflowsByMonth(
    purchases,
    config,
    financialYear,
  );
}

export function calculateProductPurchaseCashOutflowsByMonth(
  purchases: ProductPurchaseCashEntry[],
  config: InventoryBalanceConfig | null,
  financialYear: number,
): MonthlyTotals {
  return calculateInventoryPurchaseCashOutflowsByMonth(
    purchases,
    config,
    financialYear,
  );
}

export function isInventoryBalanceSheetActive(
  config: InventoryBalanceConfig | null,
  asOfDate: string,
): boolean {
  return isOnOrAfterGoLive(asOfDate, config?.go_live_date);
}

export function getMonthEndInventoryValue(
  history: InventoryValuationHistory,
  config: InventoryBalanceConfig | null,
  financialYear: number,
  monthIndex: number,
  referenceDate = new Date(),
): number {
  const totals = calculateInventoryByMonth(
    history,
    config,
    financialYear,
    referenceDate,
  );

  return totals[monthIndex] ?? 0;
}

export function emptyInventoryValuationHistory(): InventoryValuationHistory {
  return {
    finishedProductInflows: [],
    finishedProductCogs: [],
    finishedProductInternalUse: [],
    finishedProductAdjustments: [],
    rawMaterialPurchases: [],
    rawMaterialConsumptions: [],
    rawMaterialAdjustments: [],
  };
}
