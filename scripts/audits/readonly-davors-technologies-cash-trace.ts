/**
 * Trace Technologies cash 5600 + directors loan on staging.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const TENANT = "00000001-0000-4000-8000-000000000001";
const TECH = "d251c562-d522-43ec-8d9c-d1d00d4105b0";

function loadEnv(f: string) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log("=== manual_financial_entries (Technologies BU id) ===");
  const { data: mTech } = await admin
    .from("manual_financial_entries")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("business_unit_id", TECH);
  console.log(JSON.stringify(mTech, null, 2));

  console.log("\n=== manual_financial_entries NULL BU ===");
  const { data: mNull } = await admin
    .from("manual_financial_entries")
    .select("*")
    .eq("tenant_id", TENANT)
    .is("business_unit_id", null);
  console.log(JSON.stringify(mNull, null, 2));

  console.log("\n=== income_register Technologies Aug–Oct 2026 ===");
  const { data: inc } = await admin
    .from("income_register")
    .select("id,date,amount,entry_type,invoice_no,business_unit_id")
    .eq("tenant_id", TENANT)
    .eq("business_unit_id", TECH)
    .gte("date", "2026-08-01")
    .lte("date", "2026-12-31");
  console.log(inc);

  console.log("\n=== expense_register Technologies Aug–Oct 2026 ===");
  const { data: exp } = await admin
    .from("expense_register")
    .select("id,date,amount,expense_category,business_unit_id,receipt_no")
    .eq("tenant_id", TENANT)
    .eq("business_unit_id", TECH)
    .gte("date", "2026-08-01")
    .lte("date", "2026-12-31");
  console.log(exp);

  console.log("\n=== directors_loan_repayments / ledger ===");
  for (const table of [
    "directors_loan_repayments",
    "directors_loan_ledger_entries",
  ] as const) {
    const { data } = await admin
      .from(table)
      .select("*")
      .eq("tenant_id", TENANT)
      .or(`business_unit_id.eq.${TECH},business_unit_id.is.null`);
    console.log(table, data);
  }

  console.log("\n=== accounts_payable_payments Technologies + null ===");
  const { data: ap } = await admin
    .from("accounts_payable_payments")
    .select("id,payment_date,amount,business_unit_id,description")
    .eq("tenant_id", TENANT)
    .or(`business_unit_id.eq.${TECH},business_unit_id.is.null`);
  console.log(ap);

  console.log("\n=== capital_contributions ===");
  const { data: cap } = await admin
    .from("capital_contributions")
    .select("*")
    .eq("tenant_id", TENANT)
    .or(`business_unit_id.eq.${TECH},business_unit_id.is.null`);
  console.log(cap);
}

main();
