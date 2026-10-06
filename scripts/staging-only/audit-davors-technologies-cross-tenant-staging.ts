/**
 * Staging-only: cross-tenant + Technologies BU row inventory for Davors tenant.
 * npx tsx scripts/staging-only/audit-davors-technologies-cross-tenant-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";

const TENANT = "00000001-0000-4000-8000-000000000001";
const TECH = "d251c562-d522-43ec-8d9c-d1d00d4105b0";
const FAC = "de215200-e92b-48e3-a7ba-977d7289868c";
const FY = 2026;

function loadEnv(f: string) {
  for (const line of readFileSync(resolve(f), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

const TABLES = [
  "manual_financial_entries",
  "directors_loan_entries",
  "directors_loan_repayments",
  "income_register",
  "expense_register",
  "accounts_payable",
  "accounts_payable_payments",
  "capital_contributions",
  "finished_product_balances",
  "raw_material_balances",
  "credit_notes",
  "tax_ledger",
  "fixed_assets",
  "month_end_close",
] as const;

async function main() {
  loadEnv(".env.staging.local");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log("=== Cross-tenant: rows tagged Technologies BU ===\n");
  let incident = false;
  for (const table of TABLES) {
    const { data, error } = await admin
      .from(table)
      .select("*")
      .eq("business_unit_id", TECH);
    if (error) {
      console.log(`${table}: query error ${error.message}`);
      continue;
    }
    for (const row of data ?? []) {
      const tid = (row as { tenant_id?: string }).tenant_id;
      if (tid && tid !== TENANT) {
        incident = true;
        console.log("SECURITY INCIDENT", table, row);
      }
    }
    if ((data ?? []).length > 0) {
      console.log(`\n${table} (${(data ?? []).length} rows on Technologies BU):`);
      console.log(JSON.stringify(data, null, 2));
    }
  }

  if (incident) {
    console.log("\n*** STOP: cross-tenant data in Technologies scope ***");
    process.exit(3);
  }
  console.log("\nNo cross-tenant rows among Technologies-tagged registers checked.");

  console.log("\n=== Wrong-tenant rows that would leak if scope filter failed ===\n");
  for (const table of ["manual_financial_entries", "directors_loan_entries"] as const) {
    const { data } = await admin.from(table).select("id, tenant_id").eq("business_unit_id", TECH);
    const wrong = (data ?? []).filter((r) => r.tenant_id !== TENANT);
    if (wrong.length) {
      incident = true;
      console.log(table, wrong);
    }
  }

  const techData = await fetchBalanceSheetPageData(admin, TENANT, {
    viewAllBusinessUnits: false,
    activeBusinessUnitId: TECH,
    dateRange: null,
  });
  console.log("\n=== Technologies BS month checks Jul–Dec 2026 ===");
  const report = buildStandardBalanceSheetReport(techData, TENANT, FY);
  for (let mi = 6; mi <= 11; mi++) {
    console.log(`M${mi + 1}:`, getBalanceSheetMonthCheck(report, mi));
  }

  console.log("\n=== Facilities reference (should absorb loan) ===");
  const { data: facDl } = await admin
    .from("directors_loan_entries")
    .select("id, entry_date, entry_type, amount, business_unit_id, created_at, reference")
    .eq("tenant_id", TENANT)
    .eq("business_unit_id", FAC);
  console.log("Facilities DL entries:", facDl);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
