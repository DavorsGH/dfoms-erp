/**
 * Read-only: BS check + lines per scope (Facilities, Technologies, All).
 * npx tsx scripts/audits/readonly-davors-bs-all-scopes.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";
import { getBalanceSheetAmountForMonth } from "../../app/dashboard/finance/balance-sheet-utils";

const TENANT = "00000001-0000-4000-8000-000000000001";
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

function monthEnd(year: number, mi: number) {
  const m = mi + 1;
  return `${year}-${String(m).padStart(2, "0")}-${new Date(year, m, 0).getDate()}`;
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

  const { data: bus } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", TENANT)
    .order("name");
  console.log("Business units:", bus);

  const scopes: Array<{
    label: string;
    fetch: Parameters<typeof fetchBalanceSheetPageData>[2];
  }> = [
    { label: "All businesses", fetch: { viewAllBusinessUnits: true } },
    ...(bus ?? []).map((bu) => ({
      label: bu.name,
      fetch: {
        viewAllBusinessUnits: false,
        activeBusinessUnitId: bu.id,
      },
    })),
  ];

  console.log("\n=== Balance check Jul–Dec 2026 by scope ===");
  for (const scope of scopes) {
    const data = await fetchBalanceSheetPageData(admin, TENANT, scope.fetch);
    const report = buildStandardBalanceSheetReport(data, TENANT, FY);
    const parts: string[] = [];
    for (let mi = 6; mi <= 11; mi++) {
      const c = getBalanceSheetMonthCheck(report, mi);
      if (Math.abs(c.difference) >= 0.005) {
        parts.push(`${MONTH_SHORT[mi]}=${c.difference}`);
      }
    }
    console.log(
      scope.label + ":",
      parts.length ? parts.join(", ") : "balanced Jul–Dec",
    );
  }

  const tech = (bus ?? []).find((b) => b.name.includes("Technologies"));
  if (!tech) {
    console.log("No Technologies BU found");
    return;
  }

  console.log("\n=== Technologies BS lines Jul–Sep ===");
  const techData = await fetchBalanceSheetPageData(admin, TENANT, {
    viewAllBusinessUnits: false,
    activeBusinessUnitId: tech.id,
  });
  const techReport = buildStandardBalanceSheetReport(techData, TENANT, FY);
  for (const mi of [6, 7, 8]) {
    console.log(`\n--- ${monthEnd(FY, mi)} ---`);
    for (const row of techReport.rows) {
      if (row.kind === "section") continue;
      const amt = getBalanceSheetAmountForMonth(row, mi);
      if (Math.abs(amt) < 0.005) continue;
      console.log(`${row.key}\t${amt}`);
    }
    console.log("check:", getBalanceSheetMonthCheck(techReport, mi));
  }

  const allData = await fetchBalanceSheetPageData(admin, TENANT, {
    viewAllBusinessUnits: true,
  });
  const allReport = buildStandardBalanceSheetReport(allData, TENANT, FY);
  console.log("\n=== All businesses BS lines Aug (non-zero) ===");
  const mi = 7;
  for (const row of allReport.rows) {
    if (row.kind === "section") continue;
    const amt = getBalanceSheetAmountForMonth(row, mi);
    if (Math.abs(amt) < 0.005) continue;
    console.log(`${row.key}\t${amt}`);
  }
  console.log("check:", getBalanceSheetMonthCheck(allReport, mi));
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
