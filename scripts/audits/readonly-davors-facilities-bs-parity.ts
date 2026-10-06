/**
 * Read-only: Davors Facilities BS parity (dashboard path vs probe mistakes vs integrity).
 * npx tsx scripts/audits/readonly-davors-facilities-bs-parity.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import { getBalanceSheetAmountForMonth } from "../../app/dashboard/finance/balance-sheet-utils";
import { buildDashboardBalanceSheetCheck } from "../../app/dashboard/dashboard-utils";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";
import { auditTenantBalanceSheetIntegrity } from "../../utils/balance-sheet-integrity";

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

async function main() {
  let envFile = ".env.staging.local";
  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) envFile = process.argv[idx + 1]!;
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");

  const admin = createClient(url, key);
  const ref = new Date("2026-10-06T12:00:00.000Z");

  const dashData = await fetchBalanceSheetPageData(admin, TENANT, {
    activeBusinessUnitId: BU,
    viewAllBusinessUnits: false,
  });
  const dashReport = buildStandardBalanceSheetReport(dashData, TENANT, FY);

  const probeData = await fetchBalanceSheetPageData(admin, TENANT, {
    activeBusinessUnitId: BU,
    viewAllBusinessUnits: false,
    referenceDate: ref,
  });
  const probeFull = buildStandardBalanceSheetReport(probeData, TENANT, FY);

  console.log("=== BS check by month (Jul–Oct) ===");
  for (const mi of [6, 7, 8, 9]) {
    const d = buildDashboardBalanceSheetCheck(dashReport, mi);
    const pf = getBalanceSheetMonthCheck(probeFull, mi);
    console.log(
      `M${mi + 1}: dashboard=${d.difference} standardReport=${pf.difference}`,
    );
  }

  const audit = await auditTenantBalanceSheetIntegrity(
    admin,
    { id: TENANT, name: "Davors" },
    FY,
    ref,
  );
  const fac = audit.scopeResults.find((s) => s.businessUnitId === BU);
  console.log("\n=== Integrity banner (tenant-wide flat list) ===");
  console.log("imbalance rows:", audit.imbalances.length, "maxAbsDiff:", audit.maxAbsDiff);
  console.log(
    "Facilities scope:",
    fac?.imbalances.map((r) => `${r.monthLabel}=${r.diff}`).join(", "),
  );

  const mi = 9;
  console.log("\n=== Oct line items (dashboard path) ===");
  for (const row of dashReport.rows) {
    if (row.kind === "section") continue;
    const amt = getBalanceSheetAmountForMonth(row, mi);
    if (Math.abs(amt) < 0.005) continue;
    console.log(`${row.key}\t${row.label}\t${amt}`);
  }
  const oct = getBalanceSheetMonthCheck(dashReport, mi);
  console.log("\nOct totals:", oct);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
