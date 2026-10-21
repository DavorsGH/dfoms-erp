import assert from "node:assert/strict";
import {
  claimSingleSubmit,
  finishedProductNeedsOpeningCost,
  legacyRestockWeightedAverage,
  nextAverageAfterMovement,
  restockWeightedAverage,
} from "../lib/inventory/finished-product-wac";

// SKU-1012 Ballpoint Pen: 376 on hand with a stored average of -0.0222.
// Restocking 1 unit that left at zero cost keeps the average negative under
// the old blend, which then trips the balance check.
const penLegacy = legacyRestockWeightedAverage({
  oldStock: 376,
  oldAverage: -0.0222,
  restockQty: 1,
  restockUnitCost: 0,
});
assert.ok(penLegacy < 0, `expected the old blend to stay negative, got ${penLegacy}`);

const penFixed = restockWeightedAverage({
  oldStock: 376,
  oldAverage: -0.0222,
  restockQty: 1,
  restockUnitCost: 0,
});
assert.equal(penFixed, 0);

// No cost on the quantity already in stock: the average becomes the cost
// the returned unit left with, not a blend that stays at zero.
assert.equal(
  restockWeightedAverage({
    oldStock: 376,
    oldAverage: 0,
    restockQty: 2,
    restockUnitCost: 1.5,
  }),
  1.5,
);

// Healthy stock still blends.
assert.equal(
  restockWeightedAverage({
    oldStock: 10,
    oldAverage: 2,
    restockQty: 10,
    restockUnitCost: 4,
  }),
  3,
);

const corrected = nextAverageAfterMovement({
  oldStock: 376,
  oldAverage: -0.0222,
  quantityDelta: 38,
  unitCost: 1.2,
});
assert.equal(corrected.correctedNegative, true);
assert.equal(corrected.oldValue, -8.3472);
assert.equal(corrected.average, 0.1101);

const healthyPurchase = nextAverageAfterMovement({
  oldStock: 10,
  oldAverage: 2,
  quantityDelta: 10,
  unitCost: 4,
});
assert.equal(healthyPurchase.correctedNegative, false);
assert.equal(healthyPurchase.average, 3);

assert.equal(finishedProductNeedsOpeningCost(375, 0.9685), false);
assert.equal(finishedProductNeedsOpeningCost(268, 0.7933), false);
assert.equal(finishedProductNeedsOpeningCost(5, 0), true);
assert.equal(finishedProductNeedsOpeningCost(0, 0), false);
assert.equal(finishedProductNeedsOpeningCost(10, null), false);

const submitLock = { current: false };
assert.equal(claimSingleSubmit(submitLock), true);
assert.equal(submitLock.current, true);
assert.equal(claimSingleSubmit(submitLock), false);

console.log("finished product wac ok");
