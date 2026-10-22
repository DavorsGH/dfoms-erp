/**
 * Single monetary amount for inventory movements that also post to income/expense
 * register. WAC / cost_per_unit on the stock row is unchanged; only the booked
 * GHS movement is rounded once to 2 decimals.
 */
export function roundInventoryMovementAmount(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function inventoryMovementAmountFromQtyCost(
  quantityDelta: number,
  costPerUnit: number,
): number {
  return roundInventoryMovementAmount(
    (Number(quantityDelta) || 0) * (Number(costPerUnit) || 0),
  );
}
