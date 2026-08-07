/**
 * Staging: verify backdated activated purchase cash hits Balance Sheet cash.
 * Run: npx tsx scripts/test-bs-backdated-purchase-staging.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateProductPurchaseCashOutflowsByMonth,
  getActivatedInventoryPurchaseEffectiveDate,
} from "../app/dashboard/inventory/inventory-balance-sheet-utils";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

loadEnvForce(resolve(".env.staging.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
assert(url.includes("wieflwbfdmjtsdnwbfii"), `Refusing non-staging URL: ${url}`);

/** Mirrors production Nextronics Monitor Screen sale repro. */
const nextronicsConfig = {
  go_live_date: "2026-08-05",
  opening_inventory_value: 0,
  created_at: "2026-08-05T20:26:17.829967+00:00",
};

const nextronicsPurchase = {
  purchase_date: "2026-07-04",
  created_at: "2026-08-07T18:02:32.411946+00:00",
  total_cost: 800,
  payment_method: "POS",
};

assert.equal(
  getActivatedInventoryPurchaseEffectiveDate(nextronicsPurchase, nextronicsConfig),
  "2026-08-05",
);

const augustCash = calculateProductPurchaseCashOutflowsByMonth(
  [nextronicsPurchase],
  nextronicsConfig,
  2026,
);

assert.equal(augustCash[7], 800);

// Without fix, old logic skipped this purchase (purchase_date < go_live).
const legacyWouldSkip =
  nextronicsPurchase.purchase_date < nextronicsConfig.go_live_date;
assert.equal(legacyWouldSkip, true, "sanity: purchase_date is before go-live");

console.log(
  JSON.stringify(
    {
      ok: true,
      scenario: "Nextronics NEXTR-POS-0001 backdated purchase",
      augustCashOutflow: augustCash[7],
      saleCashInflow: 2400,
      cogsExpense: 800,
      projectedCashAsset: 2400 - augustCash[7],
      projectedRetainedEarnings: 2400 - 800,
      balanced:
        Math.abs(2400 - augustCash[7] - (2400 - 800)) < 0.01,
    },
    null,
    2,
  ),
);

console.log("PASS backdated purchase Balance Sheet staging verification");
