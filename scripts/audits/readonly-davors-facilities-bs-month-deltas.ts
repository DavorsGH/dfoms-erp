/**
 * Read-only: month-over-month BS line deltas + Aug gap attribution (Facilities).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import { getBalanceSheetAmountForMonth } from "../../app/dashboard/finance/balance-sheet-utils";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";
import {
  calculateFinishedProductValueAsOf,
  calculateInventoryValueAsOf,
  calculateRawMaterialValueAsOf,
} from "../../app/dashboard/inventory/inventory-balance-sheet-utils";
import { inventoryAdjustmentSignedValue } from "../../lib/inventory/inventory-stock-adjustment-financials";

const TENANT = "00000001-0000-4000-8000-000000000001";
const BU = "de215200-e92b-48e3-a7ba-977d7289868c";
const FY = 2026;

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function r2(n: number) {
  return Math.round(Number(n) * 100) / 100;
}

function monthEnd(year: number, monthIndex: number) {
  const m = monthIndex + 1;
  const d = new Date(year, m, 0).getDate();
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

async function main() {
  let envFile = ".env.staging.local";
  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) envFile = process.argv[idx + 1]!;
  loadEnv(resolve(envFile));

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const data = await fetchBalanceSheetPageData(admin, TENANT, {
    activeBusinessUnitId: BU,
    viewAllBusinessUnits: false,
  });
  const report = buildStandardBalanceSheetReport(data, TENANT, FY);

  console.log("=== Balance check Jul–Oct ===");
  for (const mi of [6, 7, 8, 9]) {
    const c = getBalanceSheetMonthCheck(report, mi);
    console.log(
      `${monthEnd(FY, mi)} diff=${c.difference} assets=${c.totalAssets} L+E=${c.totalLiabilitiesAndEquity}`,
    );
  }

  function printLines(mi: number, label: string) {
    console.log(`\n=== ${label} (${monthEnd(FY, mi)}) ===`);
    for (const row of report.rows) {
      if (row.kind === "section") continue;
      const amt = getBalanceSheetAmountForMonth(row, mi);
      if (Math.abs(amt) < 0.005 && !row.key.startsWith("total")) continue;
      console.log(`${row.key}\t${amt}`);
    }
  }

  for (const [mi, lab] of [
    [6, "July"],
    [7, "August"],
    [8, "September"],
    [9, "October"],
  ] as const) {
    printLines(mi, lab);
  }

  console.log("\n=== MoM asset+equity line deltas (Aug−Jul, Sep−Aug, Oct−Sep) ===");
  for (const [from, to, lab] of [
    [6, 7, "Aug−Jul"],
    [7, 8, "Sep−Aug"],
    [8, 9, "Oct−Sep"],
  ] as const) {
    console.log(`\n-- ${lab} --`);
    const deltas: Array<{ key: string; d: number }> = [];
    for (const row of report.rows) {
      if (row.kind === "section") continue;
      const d = r2(
        getBalanceSheetAmountForMonth(row, to) -
          getBalanceSheetAmountForMonth(row, from),
      );
      if (Math.abs(d) >= 0.01) deltas.push({ key: row.key, d });
    }
    deltas.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    for (const x of deltas) console.log(`${x.key}\t${x.d}`);
    const checkDelta = r2(
      getBalanceSheetMonthCheck(report, to).difference -
        getBalanceSheetMonthCheck(report, from).difference,
    );
    console.log(`(gap change ${lab}: ${checkDelta})`);
  }

  const inv = data.initialInventoryBalanceSheet;
  const hist = inv.valuationHistory!;
  const cfg = inv.config;
  console.log("\n=== Inventory valuation as-of month ends ===");
  for (const mi of [6, 7, 8, 9]) {
    const asOf = monthEnd(FY, mi);
    const fp = calculateFinishedProductValueAsOf(
      hist.finishedProductInflows,
      hist.finishedProductCogs,
      hist.finishedProductInternalUse,
      cfg,
      asOf,
    );
    const rm = calculateRawMaterialValueAsOf(
      hist.rawMaterialPurchases,
      hist.rawMaterialConsumptions,
      cfg,
      asOf,
      hist.rawMaterialAdjustments ?? [],
    );
    const tot = calculateInventoryValueAsOf(hist, cfg, asOf);
    const bsInv = getBalanceSheetAmountForMonth(
      report.rows.find((r) => r.key === "inventory")!,
      mi,
    );
    console.log(
      `${asOf} hist=${r2(tot.total)} fp=${r2(fp)} rm=${r2(rm)} bsLine=${bsInv}`,
    );
  }

  let cumAdj = 0;
  const goLive = cfg?.go_live_date?.slice(0, 10) ?? "";
  for (const row of inv.stockAdjustments ?? []) {
    if (String(row.effective_date).slice(0, 10) >= goLive) {
      cumAdj += inventoryAdjustmentSignedValue(row);
    }
  }
  console.log("\nCumulative stock adjustment (signed, post go-live):", r2(cumAdj));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
