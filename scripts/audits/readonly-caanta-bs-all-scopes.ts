/**
 * Read-only: Caanta BS check Jul–Dec 2026 per scope (staging).
 * npx tsx scripts/audits/readonly-caanta-bs-all-scopes.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";

const TENANT = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
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

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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

  const scopes = [
    { label: "All businesses", fetch: { viewAllBusinessUnits: true } },
    ...(bus ?? []).map((bu) => ({
      label: bu.name,
      fetch: {
        viewAllBusinessUnits: false,
        activeBusinessUnitId: bu.id,
      },
    })),
  ];

  console.log("\n=== Caanta balance check Jul–Dec 2026 by scope ===");
  let anyFail = false;
  for (const scope of scopes) {
    const data = await fetchBalanceSheetPageData(admin, TENANT, scope.fetch);
    const report = buildStandardBalanceSheetReport(data, TENANT, FY);
    const parts: string[] = [];
    for (let mi = 6; mi <= 11; mi++) {
      const c = getBalanceSheetMonthCheck(report, mi);
      if (Math.abs(c.difference) >= 0.005) {
        parts.push(`${MONTH_SHORT[mi]}=${c.difference}`);
        anyFail = true;
      }
    }
    console.log(
      scope.label + ":",
      parts.length ? parts.join(", ") : "0.00 Jul–Dec",
    );
  }
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
