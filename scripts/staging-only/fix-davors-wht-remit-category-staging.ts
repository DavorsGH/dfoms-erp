/**
 * Staging: recategorize mis-posted WHT remittance expense (Finance → Statutory Remittance).
 * Normal-path equivalent: Expense Register edit of category/sub_category only.
 *
 *   npx tsx scripts/staging-only/fix-davors-wht-remit-category-staging.ts --dry-run
 *   npx tsx scripts/staging-only/fix-davors-wht-remit-category-staging.ts --execute
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";
import {
  STATUTORY_REMITTANCE_EXPENSE_CATEGORY,
  STATUTORY_REMITTANCE_SUB_CATEGORY,
} from "../../app/dashboard/finance/tax-ledger-remit";

const TENANT = "00000001-0000-4000-8000-000000000001";
const REMIT_EXPENSE_ID = "9355a6e5-500d-4270-bb26-49ee9e96aaa0";
const FY = 2026;

function loadEnv() {
  for (const line of readFileSync(resolve(".env.staging.local"), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

async function maxGap(admin: ReturnType<typeof createClient>) {
  const { data: bus } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", TENANT);
  const scopes = [
    { label: "All", fetch: { viewAllBusinessUnits: true as const } },
    ...(bus ?? []).map((bu) => ({
      label: bu.name,
      fetch: { viewAllBusinessUnits: false as const, activeBusinessUnitId: bu.id },
    })),
  ];
  let max = 0;
  for (const s of scopes) {
    const data = await fetchBalanceSheetPageData(admin, TENANT, s.fetch);
    const report = buildStandardBalanceSheetReport(data, TENANT, FY);
    for (let mi = 6; mi <= 11; mi++) {
      const d = Math.abs(getBalanceSheetMonthCheck(report, mi).difference);
      if (d > max) max = d;
    }
  }
  return max;
}

async function main() {
  const execute = process.argv.includes("--execute");
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii")) {
    throw new Error("Refusing: not staging");
  }
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: before } = await admin
    .from("expense_register")
    .select("id, receipt_no, expense_category, sub_category, amount, date")
    .eq("id", REMIT_EXPENSE_ID)
    .single();
  console.log("Before:", before);

  const gapBefore = await maxGap(admin);
  console.log("Max |BS diff| Jul–Dec before:", gapBefore);

  if (!execute) {
    console.log("Dry-run: would set category to Statutory Remittance / Tax Remittance");
    return;
  }

  const { error } = await admin
    .from("expense_register")
    .update({
      expense_category: STATUTORY_REMITTANCE_EXPENSE_CATEGORY,
      sub_category: STATUTORY_REMITTANCE_SUB_CATEGORY,
    })
    .eq("id", REMIT_EXPENSE_ID)
    .eq("tenant_id", TENANT);

  if (error) throw error;

  const gapAfter = await maxGap(admin);
  console.log("Max |BS diff| Jul–Dec after:", gapAfter);
  const { data: after } = await admin
    .from("expense_register")
    .select("id, receipt_no, expense_category, sub_category, amount, date")
    .eq("id", REMIT_EXPENSE_ID)
    .single();
  console.log("After:", after);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
