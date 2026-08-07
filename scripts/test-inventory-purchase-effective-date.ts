import assert from "node:assert/strict";
import {
  calculateProductPurchaseCashOutflowsByMonth,
  getActivatedInventoryPurchaseEffectiveDate,
} from "../app/dashboard/inventory/inventory-balance-sheet-utils";

function runUnitTests() {
  const config = {
    go_live_date: "2026-08-05",
    opening_inventory_value: 0,
    created_at: "2026-08-05T20:26:17.829967+00:00",
  };

  const backdatedPurchase = {
    purchase_date: "2026-07-04",
    created_at: "2026-08-07T18:02:32.411946+00:00",
    total_cost: 800,
    payment_method: "POS",
  };

  assert.equal(
    getActivatedInventoryPurchaseEffectiveDate(backdatedPurchase, config),
    "2026-08-05",
    "activated backdated purchase should effective-date to go-live",
  );

  const augustCash = calculateProductPurchaseCashOutflowsByMonth(
    [backdatedPurchase],
    config,
    2026,
  );

  assert.equal(
    augustCash[7],
    800,
    "backdated activated purchase should cash-out in go-live month (August)",
  );

  const preActivation = {
    ...backdatedPurchase,
    created_at: "2026-08-04T10:00:00.000Z",
  };
  assert.equal(
    getActivatedInventoryPurchaseEffectiveDate(preActivation, config),
    null,
    "purchase created before config activation should not participate",
  );

  console.log("PASS inventory purchase effective-date unit tests");
}

runUnitTests();
