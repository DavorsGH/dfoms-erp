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
  "Cleaning Supplies - Internal Use";
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
 * Row shape returned by the get_finished_product_average_costs() database
 * function: combined production_batches + product_purchases weighted average
 * cost per finished product.
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

export function calculateInventoryByMonth(
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
  const currentMonthIndex = getEntryMonthIndex(
    normalizeDate(referenceDate.toISOString()),
    financialYear,
  );

  if (goLiveMonthIndex === null) {
    return totals;
  }

  const liveValue = calculateTotalInventoryValue(
    rawMaterials,
    finishedProducts,
    finishedProductAverageCosts,
  );

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    if (monthIndex < goLiveMonthIndex) {
      totals[monthIndex] = 0;
      continue;
    }

    if (currentMonthIndex !== null && monthIndex > currentMonthIndex) {
      totals[monthIndex] = 0;
      continue;
    }

    totals[monthIndex] = liveValue;
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

  totals[monthIndex] = roundInventoryCurrency(Number(config.opening_inventory_value) || 0);
  totals[FULL_YEAR_INDEX] = totals[monthIndex];
  return totals;
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
    if (!isOnOrAfterGoLive(purchase.purchase_date, config.go_live_date)) {
      continue;
    }

    if (!isActivatedPurchase(purchase.created_at, config)) {
      continue;
    }

    if (!isCashPaymentMethod(purchase.payment_method)) {
      continue;
    }

    const monthIndex = getEntryMonthIndex(purchase.purchase_date, financialYear);
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
  rawMaterials: Array<Pick<RawMaterialRecord, "current_stock" | "average_cost_per_unit">>,
  finishedProducts: Array<Pick<FinishedProductRecord, "id" | "current_stock">>,
  finishedProductAverageCosts: FinishedProductAverageCostRow[],
  config: InventoryBalanceConfig | null,
  financialYear: number,
  monthIndex: number,
  referenceDate = new Date(),
): number {
  const totals = calculateInventoryByMonth(
    rawMaterials,
    finishedProducts,
    finishedProductAverageCosts,
    config,
    financialYear,
    referenceDate,
  );

  return totals[monthIndex] ?? 0;
}
