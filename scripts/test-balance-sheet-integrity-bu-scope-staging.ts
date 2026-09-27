/**
 * Staging: BS integrity cron audits all businesses + each BU; detects injected BU imbalance.
 *
 *   npx tsx scripts/test-balance-sheet-integrity-bu-scope-staging.ts --env-file .env.staging.local
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { auditTenantBalanceSheetIntegrity } from "../utils/balance-sheet-integrity";
import { getCurrentFinancialYear } from "../app/dashboard/finance/finance-year-utils";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const STAMP = `BS-BU-TEST-${Date.now()}`;

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  let envFile = ".env.staging.local";
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--env-file=")) envFile = arg.slice("--env-file=".length);
  }
  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) envFile = process.argv[idx + 1]!;

  loadEnv(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes("wieflwbfdmjtsdnwbfii") || url.includes("staging"), `Refusing: ${url}`);

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: units, error: buErr } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", DAVORS)
    .order("name");
  assert(!buErr && units?.length, "Need Davors business units on staging");

  const targetUnit = units!.find((u) => /facilities/i.test(u.name)) ?? units![0];
  const fy = getCurrentFinancialYear();
  const monthIndex = 5; // June
  const injectDate = `${fy}-06-15`;
  const injectAmount = 777.77;
  const assetId = `${STAMP}-ASSET`;

  const { data: inserted, error: insErr } = await admin
    .from("fixed_assets")
    .insert({
      tenant_id: DAVORS,
      business_unit_id: targetUnit.id,
      asset_id: assetId,
      asset_name: STAMP,
      asset_category: "Test Equipment",
      purchase_date: injectDate,
      original_cost: injectAmount,
      quantity: 1,
      total_cost: injectAmount,
      useful_life_years: 5,
      depreciation_method: "Straight-Line",
      annual_depreciation: injectAmount / 5,
      accumulated_depreciation: 0,
      net_book_value: injectAmount,
      location: STAMP,
      payment_method: "Credit",
      vendor_name: STAMP,
      approved_by: "System",
      gross_before_wht: injectAmount,
      net_of_tax_amount: injectAmount,
      notes: STAMP,
    })
    .select("asset_id")
    .single();
  assert(!insErr && inserted?.asset_id, insErr?.message ?? "fixed_assets insert failed");

  try {
    const audit = await auditTenantBalanceSheetIntegrity(
      admin,
      { id: DAVORS, name: "Davors Facilities" },
      fy,
      new Date(`${fy}-12-15T12:00:00Z`),
    );

    assert(!audit.fetchError, audit.fetchError ?? "fetch error");
    assert(audit.scopeResults.length >= 2, "Expected tenant + BU scopes");

    const tenantScope = audit.scopeResults.find((s) => s.scope === "tenant");
    const buScope = audit.scopeResults.find(
      (s) => s.businessUnitId === targetUnit.id,
    );
    assert(tenantScope, "missing tenant scope");
    assert(buScope, "missing target BU scope");

    const tenantHit = audit.imbalances.some(
      (row) =>
        row.businessUnitId === null &&
        row.monthIndex === monthIndex &&
        Math.abs(row.diff) >= injectAmount - 1,
    );
    const buHit = audit.imbalances.some(
      (row) =>
        row.businessUnitId === targetUnit.id &&
        row.monthIndex === monthIndex &&
        Math.abs(row.diff) >= injectAmount - 1,
    );

    assert(tenantHit, `Tenant-wide audit should detect June imbalance (~${injectAmount})`);
    assert(buHit, `BU ${targetUnit.name} audit should detect injected imbalance`);
    assert(
      audit.imbalances.every((row) => row.businessUnitName),
      "Each imbalance should include businessUnitName",
    );

    console.log("PASS: integrity cron BU + tenant scope detection");
    console.log(
      "Sample imbalance:",
      JSON.stringify(audit.imbalances.find((r) => r.monthIndex === monthIndex)),
    );
  } finally {
    await admin
      .from("fixed_assets")
      .delete()
      .eq("tenant_id", DAVORS)
      .eq("asset_id", assetId);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
