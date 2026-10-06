/**
 * Read-only: NULL-BU exposure + BU count + simulated aggregation parity impact.
 * npx tsx scripts/audits/readonly-null-bu-parity-impact-production.ts
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import { auditBalanceSheetScopeAggregationParity } from "../../utils/balance-sheet-integrity";

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const FY = 2026;
const MONTHS = Array.from({ length: 12 }, (_, i) => i);

const COUNT_TABLES = [
  "income_register",
  "expense_register",
  "manual_financial_entries",
  "finished_product_balances",
  "product_purchases",
] as const;

function loadEnv(f: string) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadEnv(".env.local.production-backup-2026-08-25");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: tenants } = await admin.from("tenants").select("id, name").order("name");

  for (const tenant of tenants ?? []) {
    let nullTotal = 0;
    for (const table of COUNT_TABLES) {
      const { count } = await admin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .is("business_unit_id", null);
      nullTotal += count ?? 0;
    }
    if (nullTotal === 0) continue;

    const { data: bus } = await admin
      .from("business_units")
      .select("id, name")
      .eq("tenant_id", tenant.id)
      .order("name");

    const buCount = bus?.length ?? 0;
    const repair =
      buCount === 1
        ? `359-style: assign NULL rows to sole BU ${bus![0]!.name}`
        : "Multi-BU: manual BU assignment per register (no auto primary)";

    const allData = await fetchBalanceSheetPageData(admin, tenant.id, {
      viewAllBusinessUnits: true,
      dateRange: null,
    });
    const untaggedData = await fetchBalanceSheetPageData(admin, tenant.id, {
      viewAllBusinessUnits: false,
      activeBusinessUnitId: null,
      dateRange: null,
    });
    const unitDataList = [];
    for (const bu of bus ?? []) {
      const data = await fetchBalanceSheetPageData(admin, tenant.id, {
        viewAllBusinessUnits: false,
        activeBusinessUnitId: bu.id,
        dateRange: null,
      });
      unitDataList.push({
        businessUnitId: bu.id,
        businessUnitName: bu.name,
        data,
      });
    }
    const parity = auditBalanceSheetScopeAggregationParity(
      allData,
      untaggedData,
      unitDataList,
      tenant.id,
      FY,
      MONTHS,
    );

    console.log(`\n=== ${tenant.name} ===`);
    console.log(`  business_units: ${buCount}`);
    console.log(`  NULL-BU row count (sample tables): ${nullTotal}`);
    console.log(`  proposed repair: ${repair}`);
    console.log(
      `  nightly aggregation parity warnings (FY${FY}): ${parity.length > 0 ? parity.length + " month(s)" : "none"}`,
    );
    if (parity.length > 0) {
      console.log(
        `  worst parity diff: ${Math.max(...parity.map((p) => Math.abs(p.diff)))}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
