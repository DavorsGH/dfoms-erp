/**
 * Unit tests: month-aware inventory Balance Sheet valuation.
 *
 * Usage:
 *   npx tsx scripts/test-inventory-month-aware-valuation-unit.ts
 */
import assert from "node:assert/strict";
import {
  calculateInventoryByMonth,
  calculateInventoryOpeningEquityByMonth,
  calculateInventoryValueAsOf,
  type InventoryBalanceConfig,
  type InventoryValuationHistory,
} from "../app/dashboard/inventory/inventory-balance-sheet-utils";
import { FULL_YEAR_INDEX } from "../app/dashboard/finance/profit-loss-utils";

const FY = 2026;

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

function runUnitTests() {
  // --- Davors-like: Liquid Soap from early production; Water purchased mid-August ---
  const davorsConfig: InventoryBalanceConfig = {
    go_live_date: "2026-01-01",
    opening_inventory_value: 0,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  const soapBatchCost = r2(50 * 5.3004); // 265.02
  const waterPurchaseQty = 10_000;
  const waterUnit = 0.1;
  const waterConsumed = 50; // leftover 9950 × 0.1 = 995

  const davorsHistory: InventoryValuationHistory = {
    finishedProductInflows: [
      {
        product_id: "soap",
        source: "production",
        event_date: "2026-03-15",
        created_at: "2026-03-15T12:00:00.000Z",
        total_cost: soapBatchCost,
      },
    ],
    finishedProductCogs: [],
    finishedProductInternalUse: [],
    rawMaterialPurchases: [
      {
        material_id: "water",
        purchase_date: "2026-08-23",
        created_at: "2026-08-23T16:15:00.000Z",
        quantity: waterPurchaseQty,
        cost_per_unit: waterUnit,
      },
    ],
    rawMaterialConsumptions: [
      {
        material_id: "water",
        consumption_date: "2026-08-23",
        quantity_used: waterConsumed,
      },
    ],
  };

  const refAug24 = new Date("2026-08-24T12:00:00.000Z");
  const davorsMonths = calculateInventoryByMonth(
    davorsHistory,
    davorsConfig,
    FY,
    refAug24,
  );

  assert.equal(davorsMonths[0], 0, "Jan: no inventory activity yet");
  assert.equal(davorsMonths[1], 0, "Feb: no inventory activity yet");
  assert.equal(davorsMonths[2], soapBatchCost, "Mar: soap batch only");
  assert.equal(davorsMonths[6], soapBatchCost, "Jul: still soap only (no water yet)");
  assert.equal(
    davorsMonths[7],
    r2(soapBatchCost + (waterPurchaseQty - waterConsumed) * waterUnit),
    "Aug: soap + remaining water",
  );
  assert.equal(
    davorsMonths[8],
    davorsMonths[7],
    "Sep: carry forward current-month value (2aa961e projection)",
  );
  assert.equal(
    davorsMonths[11],
    davorsMonths[7],
    "Dec: carry forward current-month value",
  );
  assert.equal(
    davorsMonths[FULL_YEAR_INDEX],
    davorsMonths[11],
    "FULL_YEAR uses December snapshot",
  );

  // Live-paint bug regression: Aug water must NOT appear in July
  assert.notEqual(
    davorsMonths[6],
    davorsMonths[7],
    "mid-year purchase must not backdate into earlier months",
  );

  // --- Mid-year go-live (Aug): months before go-live stay 0 ---
  const midYearConfig: InventoryBalanceConfig = {
    go_live_date: "2026-08-05",
    opening_inventory_value: 500,
    created_at: "2026-08-05T20:26:17.829Z",
  };
  const midYearHistory: InventoryValuationHistory = {
    finishedProductInflows: [
      {
        product_id: "p1",
        source: "purchase",
        event_date: "2026-07-04", // backdated; activated → go-live
        created_at: "2026-08-07T18:02:32.411Z",
        total_cost: 800,
      },
    ],
    finishedProductCogs: [
      {
        product_id: "p1",
        sale_date: "2026-08-10",
        cogs_amount: 100,
      },
      {
        product_id: "p1",
        sale_date: "2026-08-12",
        cogs_amount: -40, // reversal (signed expense amount)
      },
    ],
    finishedProductInternalUse: [],
    rawMaterialPurchases: [],
    rawMaterialConsumptions: [],
  };

  const midYearMonths = calculateInventoryByMonth(
    midYearHistory,
    midYearConfig,
    FY,
    refAug24,
  );

  for (let m = 0; m < 7; m += 1) {
    assert.equal(midYearMonths[m], 0, `pre-go-live month ${m} must be 0`);
  }
  assert.equal(
    midYearMonths[7],
    740,
    "Aug: activated purchase 800 − COGS 100 + reversal 40",
  );
  assert.equal(midYearMonths[9], 740, "future months carry Aug value");

  // Pre-go-live COGS still reduce carrying value once purchase is activated
  // (Mimshack-style: sale business-dated before go-live).
  const mimshackStyle: InventoryValuationHistory = {
    finishedProductInflows: [
      {
        product_id: "perfume",
        source: "purchase",
        event_date: "2026-07-26",
        created_at: "2026-08-08T21:26:04.000Z",
        total_cost: 5000,
      },
    ],
    finishedProductCogs: [
      {
        product_id: "perfume",
        sale_date: "2026-08-01",
        cogs_amount: 1000,
      },
    ],
    finishedProductInternalUse: [],
    rawMaterialPurchases: [],
    rawMaterialConsumptions: [],
  };
  const mimshackConfig: InventoryBalanceConfig = {
    go_live_date: "2026-08-08",
    opening_inventory_value: 0,
    created_at: "2026-08-08T20:00:00.000Z",
  };
  assert.equal(
    calculateInventoryValueAsOf(mimshackStyle, mimshackConfig, "2026-08-24"),
    4000,
    "activated purchase minus pre-go-live COGS must match live WAC carrying value",
  );

  // Internal consumption reduces carrying value by consumption_date (script 241).
  const internalUseHistory: InventoryValuationHistory = {
    finishedProductInflows: [
      {
        product_id: "soap",
        source: "production",
        event_date: "2026-03-15",
        created_at: "2026-03-15T12:00:00.000Z",
        total_cost: 1000,
      },
    ],
    finishedProductCogs: [],
    finishedProductInternalUse: [
      {
        product_id: "soap",
        consumption_date: "2026-08-20",
        amount: 200,
      },
    ],
    rawMaterialPurchases: [],
    rawMaterialConsumptions: [],
  };
  assert.equal(
    calculateInventoryValueAsOf(internalUseHistory, davorsConfig, "2026-08-24"),
    800,
    "internal use expense reduces month-aware inventory carrying value",
  );

  // Opening equity: go-live month only; FULL_YEAR = December (Caanta fix)
  const openingEquity = calculateInventoryOpeningEquityByMonth(
    midYearConfig,
    FY,
  );
  assert.equal(openingEquity[7], 500, "opening equity posts in go-live month");
  assert.equal(openingEquity[0], 0, "opening equity not in January");
  assert.equal(openingEquity[11], 0, "December opening equity is 0 (go-live-only)");
  assert.equal(
    openingEquity[FULL_YEAR_INDEX],
    openingEquity[11],
    "FULL_YEAR opening equity uses December (Caanta 2026-08-18 fix)",
  );

  // Point-in-time asOf before first activity
  assert.equal(
    calculateInventoryValueAsOf(
      davorsHistory,
      davorsConfig,
      "2026-02-28",
    ),
    0,
  );
  assert.equal(
    calculateInventoryValueAsOf(
      davorsHistory,
      davorsConfig,
      "2026-03-31",
    ),
    soapBatchCost,
  );

  // Production before go-live is excluded
  const preGoLiveHistory: InventoryValuationHistory = {
    finishedProductInflows: [
      {
        product_id: "p1",
        source: "production",
        event_date: "2026-07-01",
        created_at: "2026-07-01T00:00:00.000Z",
        total_cost: 999,
      },
    ],
    finishedProductCogs: [],
    finishedProductInternalUse: [],
    rawMaterialPurchases: [],
    rawMaterialConsumptions: [],
  };
  assert.equal(
    calculateInventoryValueAsOf(
      preGoLiveHistory,
      midYearConfig,
      "2026-08-31",
    ),
    0,
    "production before go-live must not count",
  );

  console.log("PASS inventory month-aware valuation unit tests");
}

runUnitTests();
