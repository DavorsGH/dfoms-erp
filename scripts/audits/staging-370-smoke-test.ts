/**
 * After 370 on staging: zero-BU WAC, multi-BU NULL guard, Davors BS matrix.
 * npx tsx scripts/audits/staging-370-smoke-test.ts
 */
import { connectPg } from "../lib/pg-connect";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;

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
  loadEnv(".env.staging.local");
  const { client } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });

  const { rows: zeroBuTenants } = await client.query(
    `SELECT t.id, t.name FROM tenants t
     WHERE NOT EXISTS (SELECT 1 FROM business_units bu WHERE bu.tenant_id = t.id)
     ORDER BY t.name LIMIT 3`,
  );

  console.log("=== Zero-BU tenants (sample) ===");
  for (const t of zeroBuTenants) {
    const { rows: prods } = await client.query(
      `SELECT fp.id, fp.product_code, fpb.current_stock,
        public.finished_product_weighted_avg_cost_scoped(fp.id, NULL) AS scoped_null_wac,
        public.finished_product_weighted_avg_cost(fp.id) AS tenant_wac
       FROM finished_products fp
       LEFT JOIN finished_product_balances fpb ON fpb.product_id = fp.id AND fpb.business_unit_id IS NULL
       WHERE fp.tenant_id = $1 AND coalesce(fpb.current_stock,0) > 0 LIMIT 2`,
      [t.id],
    );
    console.log(t.name, prods);
  }

  console.log("\n=== Multi-BU NULL guard (Davors) ===");
  try {
    await client.query(
      `SELECT public.resolve_business_unit_for_inventory_mutation($1::uuid, NULL)`,
      [DAVORS],
    );
    console.log("UNEXPECTED: NULL BU resolved without error");
  } catch (e) {
    console.log("OK:", (e as Error).message.slice(0, 120));
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: bus } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", DAVORS);

  const scopes = [
    { label: "All", fetch: { viewAllBusinessUnits: true, dateRange: null } },
    { label: "NULL", fetch: { viewAllBusinessUnits: false, activeBusinessUnitId: null, dateRange: null } },
    ...(bus ?? []).map((bu) => ({
      label: bu.name,
      fetch: {
        viewAllBusinessUnits: false,
        activeBusinessUnitId: bu.id,
        dateRange: null,
      },
    })),
  ];

  console.log("\n=== Davors BS Jul–Dec max |diff| ===");
  let fail = false;
  for (const s of scopes) {
    const data = await fetchBalanceSheetPageData(admin, DAVORS, s.fetch);
    const report = buildStandardBalanceSheetReport(data, DAVORS, FY, {
      allBusinessUnitsDirectorsLoan: true,
      rawManualFinancialEntries: data.initialRawManualEntries,
    });
    let max = 0;
    for (let mi = 6; mi <= 11; mi++) {
      const c = getBalanceSheetMonthCheck(report, mi);
      max = Math.max(max, Math.abs(c.difference));
    }
    console.log(s.label, max);
    if (max > 0.005) fail = true;
  }
  await client.end();
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
