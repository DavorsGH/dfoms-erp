/**
 * PRODUCTION: Restore missing ADJ-JUNE-FORFEIT-2026 income row (direct insert, not UI).
 *
 * Shape = original insert from apply-june-july-payroll-corrections-production.ts
 * plus outstanding_balance=0 from fix-bs-631-forfeit-and-accrued-production.ts,
 * plus explicit zero VAT/WHT fields (DEDSAV lesson — avoid tax-ledger side effects).
 *
 * Usage:
 *   npx tsx scripts/restore-june-forfeit-income-production.ts --dry-run
 *   npx tsx --env-file .env.local.backup scripts/restore-june-forfeit-income-production.ts --allow-production
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { mergePayrollWagesSources } from "../app/dashboard/finance/accrued-wages-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";

const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const FORFEIT_INVOICE = "ADJ-JUNE-FORFEIT-2026";
const FORFEIT_AMOUNT = 88.09;
const FORFEIT_DESC =
  "June correction forfeited (DF0007, DF0015, DF0018, DF0019)";

/** Final shape before deletion (insert + outstanding cleared to 0). */
const FORFEIT_PAYLOAD = {
  tenant_id: TENANT,
  date: "2026-06-30",
  due_date: "2026-06-30",
  invoice_no: FORFEIT_INVOICE,
  customer_name: null,
  client_id: null,
  entry_type: "service",
  service_category: "Other Income",
  description: FORFEIT_DESC,
  amount: FORFEIT_AMOUNT,
  amount_received: 0,
  outstanding_balance: 0,
  payment_status: "Unpaid",
  notes:
    "Forfeited June wage shortfall for terminated/inactive staff; non-cash P&L income.",
  tax_inclusive: true,
  net_of_tax_amount: FORFEIT_AMOUNT,
  output_vat_amount: 0,
  output_tax_component: null,
  wht_rate: null,
  wht_amount: 0,
  sale_status: "active",
};

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function parseArgs(argv) {
  let envFile = ".env.local.backup";
  let allowProduction = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--allow-production") allowProduction = true;
    else if (arg === "--env-file") envFile = argv[++i] ?? envFile;
  }
  return { envFile, allowProduction, dryRun };
}

function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function computeGaps(admin) {
  const [
    { data: incomeEntries, error: incomeErr },
    { data: expenseEntries },
    { data: fixedAssets },
    { data: payableEntries },
    { data: capitalContributions },
    { data: manualEntries },
    { data: payrollHistory },
    { data: payrollProcessing },
    { data: monthEndCloseRecords },
    { data: taxLedgerEntries },
    inventoryBalanceSheet,
  ] = await Promise.all([
    admin.from("income_register").select("*").eq("tenant_id", TENANT),
    admin.from("expense_register").select("*").eq("tenant_id", TENANT),
    admin.from("fixed_assets").select("*").eq("tenant_id", TENANT),
    admin.from("accounts_payable").select("*").eq("tenant_id", TENANT),
    admin.from("capital_contributions").select("*").eq("tenant_id", TENANT),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT),
    admin
      .from("payroll_history")
      .select("payroll_month, net_pay, net_only_adjustment")
      .eq("tenant_id", TENANT),
    admin
      .from("payroll_processing")
      .select("payroll_month, net_pay, net_only_adjustment")
      .eq("tenant_id", TENANT),
    admin
      .from("month_end_close")
      .select("month, total_net_pay, lock_status")
      .eq("tenant_id", TENANT),
    admin.from("tax_ledger_entries").select("*").eq("tenant_id", TENANT),
    fetchInventoryBalanceSheetInput(admin, TENANT),
  ]);
  if (incomeErr) throw incomeErr;

  const cashFlow = (expenseEntries ?? []).map((e) => ({
    date: e.date,
    expense_category: e.expense_category,
    sub_category: e.sub_category,
    amount: Number(e.amount) || 0,
    payment_status: e.payment_status,
    description: e.description ?? null,
    receipt_no: e.receipt_no ?? null,
    notes: e.notes ?? null,
  }));

  const report = buildBalanceSheetReport(
    incomeEntries ?? [],
    expenseEntries ?? [],
    fixedAssets ?? [],
    payableEntries ?? [],
    capitalContributions ?? [],
    cashFlow,
    mergePayrollWagesSources(payrollHistory ?? [], payrollProcessing ?? []),
    monthEndCloseRecords ?? [],
    FY,
    inventoryBalanceSheet,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
  );

  return {
    june: getBalanceCheckForPeriod(report, 5),
    july: getBalanceCheckForPeriod(report, 6),
  };
}

async function main() {
  const { envFile, allowProduction, dryRun } = parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(`Not production URL: ${url}`);
  }
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing, error: existErr } = await admin
    .from("income_register")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("invoice_no", FORFEIT_INVOICE)
    .maybeSingle();
  if (existErr) throw existErr;

  if (existing) {
    throw new Error(
      `Refusing insert — ${FORFEIT_INVOICE} already exists as id=${existing.id}`,
    );
  }

  console.log("=== BEFORE gaps ===");
  const before = await computeGaps(admin);
  console.log("June:", before.june);
  console.log("July:", before.july);

  console.log("\n=== Payload to insert ===");
  console.log(JSON.stringify(FORFEIT_PAYLOAD, null, 2));

  if (dryRun) {
    console.log("\nDRY-RUN — no write.");
    return;
  }
  if (!allowProduction) {
    throw new Error("Refusing writes without --allow-production");
  }

  const { data: inserted, error: insertErr } = await admin
    .from("income_register")
    .insert(FORFEIT_PAYLOAD)
    .select("*")
    .single();
  if (insertErr) throw insertErr;

  // Guard: no tax_ledger legs should exist for this income
  const { data: taxLegs, error: taxErr } = await admin
    .from("tax_ledger_entries")
    .select("id, tax_component, tax_amount, status")
    .eq("tenant_id", TENANT)
    .eq("source_type", "income_register")
    .eq("source_id", inserted.id);
  if (taxErr) throw taxErr;
  if ((taxLegs ?? []).length > 0) {
    throw new Error(
      `Unexpected tax_ledger legs created for forfeit: ${JSON.stringify(taxLegs)}`,
    );
  }

  console.log("\n=== Inserted row ===");
  console.log(JSON.stringify(inserted, null, 2));

  console.log("\n=== AFTER gaps ===");
  const after = await computeGaps(admin);
  console.log("June:", after.june);
  console.log("July:", after.july);
  console.log(
    `\nExpected June ~38.00 (got ${r2(after.june.difference)}), July ~-2.00 (got ${r2(after.july.difference)})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
