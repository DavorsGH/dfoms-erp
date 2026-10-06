/**
 * Read-only: trace Davors Sep–Dec 2026 BS micro-gaps (0.01–0.02).
 * npx tsx scripts/audits/readonly-davors-sep-dec-micro-gap-production.ts
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";
import { getBalanceSheetAmountForMonth } from "../../app/dashboard/finance/balance-sheet-utils";

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const FY = 2026;
const DAVORS = "Davors";

function loadEnv(f: string) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

async function traceScope(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  label: string,
  fetch: Parameters<typeof fetchBalanceSheetPageData>[2],
  all: boolean,
) {
  const data = await fetchBalanceSheetPageData(admin, tenantId, fetch);
  const report = buildStandardBalanceSheetReport(data, tenantId, FY, all
    ? {
        allBusinessUnitsDirectorsLoan: true,
        rawManualFinancialEntries: data.initialRawManualEntries,
      }
    : {});

  for (const mi of [8, 9, 10, 11]) {
    const check = getBalanceSheetMonthCheck(report, mi);
    if (Math.abs(check.difference) < 0.004) continue;
    console.log(`\n${label} ${FY}-${String(mi + 1).padStart(2, "0")} diff=${check.difference}`);
    console.log("  assets", check.totalAssets, "liab+eq", check.totalLiabilitiesAndEquity);
    const rows = report.rows.filter((r) => r.kind !== "section");
    let assetSum = 0;
    let leSum = 0;
    for (const row of rows) {
      const amt = getBalanceSheetAmountForMonth(row, mi);
      if (Math.abs(amt) < 0.0001) continue;
      if (row.section === "assets") assetSum += amt;
      else leSum += amt;
      console.log(`    ${row.section}\t${row.key}\t${amt}`);
    }
    console.log(`  recomputed assets=${Math.round(assetSum * 100) / 100} L+E=${Math.round(leSum * 100) / 100}`);
  }
}

async function main() {
  loadEnv(".env.local.production-backup-2026-08-25");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name")
    .ilike("name", `%${DAVORS}%`)
    .limit(1)
    .maybeSingle();
  if (!tenant) throw new Error("Davors tenant not found");

  const { data: bus } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", tenant.id);

  await traceScope(
    admin,
    tenant.id,
    "All businesses",
    { viewAllBusinessUnits: true, dateRange: null },
    true,
  );
  const facilities = (bus ?? []).find((b) => /facilities/i.test(String(b.name)));
  if (facilities) {
    await traceScope(
      admin,
      tenant.id,
      String(facilities.name),
      {
        viewAllBusinessUnits: false,
        activeBusinessUnitId: facilities.id,
        dateRange: null,
      },
      false,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
