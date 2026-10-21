function round4(value: number): number {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

export type RestockAverageInput = {
  oldStock: number;
  oldAverage: number;
  restockQty: number;
  /** Cost the unit left at (the sale's COGS per unit). */
  restockUnitCost: number;
};

/**
 * Previous restock blend. A negative stored average stays negative, which is
 * how SKU-1012 drifted to about -0.0222 and then failed the balance check.
 */
export function legacyRestockWeightedAverage(input: RestockAverageInput): number {
  const newStock = input.oldStock + input.restockQty;
  if (newStock <= 0) {
    return 0;
  }
  return round4(
    (input.oldStock * input.oldAverage + input.restockQty * input.restockUnitCost) /
      newStock,
  );
}

/**
 * Restock at the cost the item left with. When the stock already on hand is
 * worth nothing or less, the new average is that restock cost. The result is
 * never below zero.
 */
export function restockWeightedAverage(input: RestockAverageInput): number {
  const unit = round4(Math.max(input.restockUnitCost, 0));
  const oldValue = input.oldStock * input.oldAverage;
  if (!(oldValue > 0)) {
    return unit;
  }
  const newStock = input.oldStock + input.restockQty;
  if (newStock <= 0) {
    return 0;
  }
  const blended = round4((oldValue + input.restockQty * unit) / newStock);
  return blended < 0 ? unit : blended;
}

export type MovementAverageInput = {
  oldStock: number;
  oldAverage: number;
  /** Signed quantity. Purchases and opening stock are positive; sales are negative. */
  quantityDelta: number;
  /** Unit cost of this movement (purchase cost, or COGS per unit on a sale). */
  unitCost: number;
};

/**
 * Next stored average after a purchase, adjustment, or sale.
 * A negative existing stock value is legacy bad data: it counts as 0, and the
 * caller should log system_event_log event_name negative_wac_corrected.
 */
export function nextAverageAfterMovement(input: MovementAverageInput): {
  average: number;
  correctedNegative: boolean;
  oldValue: number;
} {
  const oldValue = round4(input.oldStock * input.oldAverage);
  const correctedNegative = oldValue < 0;
  const baseValue = correctedNegative ? 0 : oldValue;
  const newStock = input.oldStock + input.quantityDelta;
  if (newStock <= 0) {
    return { average: 0, correctedNegative, oldValue };
  }
  const movementValue = input.quantityDelta * input.unitCost;
  const average = round4((baseValue + movementValue) / newStock);
  return {
    average: average < 0 ? 0 : average,
    correctedNegative,
    oldValue,
  };
}

export const NEGATIVE_WAC_USER_MESSAGE =
  "This product's stock has no usable cost, so the update was stopped. Set an opening cost on the product in this business unit, then try again.";

export function mapNegativeWacUserMessage(raw: string | null | undefined): string | null {
  const message = raw?.trim() ?? "";
  if (!message) {
    return null;
  }
  if (
    /average_cost_per_unit/i.test(message) ||
    /weighted-average cost cannot be negative/i.test(message) ||
    /finished_product_balances/i.test(message)
  ) {
    return NEGATIVE_WAC_USER_MESSAGE;
  }
  return null;
}

/**
 * Badge and the Set opening cost guard both use the outflow unit cost.
 * A missing figure is not treated as zero — only a known cost of 0 (or less)
 * with stock on hand needs an opening cost.
 */
export function finishedProductNeedsOpeningCost(
  currentStock: number,
  outflowUnitCost: number | null | undefined,
): boolean {
  if (!(currentStock > 0)) {
    return false;
  }
  if (outflowUnitCost == null || !Number.isFinite(Number(outflowUnitCost))) {
    return false;
  }
  return !(Number(outflowUnitCost) > 0);
}

/** True only for the first click while a save is in flight. */
export function claimSingleSubmit(lock: { current: boolean }): boolean {
  if (lock.current) {
    return false;
  }
  lock.current = true;
  return true;
}
