/**
 * Unit tests: calculateInventoryOpeningEquityByMonth go-live-only behaviour.
 * Usage: npx tsx scripts/test-inventory-opening-equity-by-month.ts
 */
import assert from "node:assert/strict";
import { FULL_YEAR_INDEX } from "../app/dashboard/finance/profit-loss-utils";
import { calculateInventoryOpeningEquityByMonth } from "../app/dashboard/inventory/inventory-balance-sheet-utils";

const FY = 2026;

function assertAllZero(totals: number[], label: string) {
  for (let i = 0; i < 12; i += 1) {
    assert.equal(totals[i], 0, `${label}: month index ${i} should be 0`);
  }
  assert.equal(totals[FULL_YEAR_INDEX], 0, `${label}: FULL_YEAR_INDEX should be 0`);
}

function runUnitTests() {
  // Go-live January — value only in January; year column = go-live month.
  const janGoLive = calculateInventoryOpeningEquityByMonth(
    {
      go_live_date: "2026-01-01",
      opening_inventory_value: 2730,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    FY,
  );
  assert.equal(janGoLive[0], 2730, "Jan go-live: January should be 2730");
  for (let i = 1; i < 12; i += 1) {
    assert.equal(janGoLive[i], 0, `Jan go-live: month index ${i} should be 0`);
  }
  assert.equal(janGoLive[FULL_YEAR_INDEX], 2730, "Jan go-live: year column = go-live month");

  // Go-live July — zero Jan-Jun, value in July only; year column = July.
  const julGoLive = calculateInventoryOpeningEquityByMonth(
    {
      go_live_date: "2026-07-15",
      opening_inventory_value: 1500.5,
      created_at: "2026-07-01T00:00:00.000Z",
    },
    FY,
  );
  for (let i = 0; i < 6; i += 1) {
    assert.equal(julGoLive[i], 0, `Jul go-live: pre-go-live month ${i} should be 0`);
  }
  assert.equal(julGoLive[6], 1500.5, "Jul go-live: July should be 1500.5");
  for (let i = 7; i < 12; i += 1) {
    assert.equal(julGoLive[i], 0, `Jul go-live: post-go-live month ${i} should be 0`);
  }
  assert.equal(julGoLive[FULL_YEAR_INDEX], 1500.5, "Jul go-live: year column = go-live month");

  // No config — all zero.
  assertAllZero(calculateInventoryOpeningEquityByMonth(null, FY), "null config");

  // Zero opening value — all zero.
  assertAllZero(
    calculateInventoryOpeningEquityByMonth(
      {
        go_live_date: "2026-01-01",
        opening_inventory_value: 0,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      FY,
    ),
    "zero opening_inventory_value",
  );

  console.log("PASS calculateInventoryOpeningEquityByMonth unit tests");
}

runUnitTests();
