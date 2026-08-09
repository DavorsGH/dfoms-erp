/**
 * Unit tests: calculateInventoryOpeningEquityByMonth carry-forward behaviour.
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
  // Go-live January — value in every month Jan-Dec; year column = December.
  const janGoLive = calculateInventoryOpeningEquityByMonth(
    {
      go_live_date: "2026-01-01",
      opening_inventory_value: 2730,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    FY,
  );
  for (let i = 0; i < 12; i += 1) {
    assert.equal(
      janGoLive[i],
      2730,
      `Jan go-live: month index ${i} should be 2730`,
    );
  }
  assert.equal(
    janGoLive[FULL_YEAR_INDEX],
    janGoLive[11],
    "Jan go-live: FULL_YEAR_INDEX should match December (index 11)",
  );
  assert.equal(janGoLive[FULL_YEAR_INDEX], 2730, "Jan go-live: year column = 2730");

  // Go-live July — zero Jan-Jun, value Jul-Dec; year column = December.
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
  for (let i = 6; i < 12; i += 1) {
    assert.equal(julGoLive[i], 1500.5, `Jul go-live: month index ${i} should be 1500.5`);
  }
  assert.equal(
    julGoLive[FULL_YEAR_INDEX],
    julGoLive[11],
    "Jul go-live: FULL_YEAR_INDEX should match December",
  );
  assert.equal(julGoLive[FULL_YEAR_INDEX], 1500.5, "Jul go-live: year column = 1500.5");

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
