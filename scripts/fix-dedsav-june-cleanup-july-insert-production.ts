/**
 * PRODUCTION: Clean June DEDSAV mess + insert correct July-only DEDSAV.
 *
 * 1) Delete tax_ledger_entries id 51539700-... then income_register
 *    PAYROLL-DEDSAV-2026-06 (id 8091b3ef-...).
 * 2) Insert PAYROLL-DEDSAV-2026-07 with exact non-cash Other Income shape
 *    (no UI / no VAT recalculation).
 *
 * Usage:
 *   npx tsx scripts/fix-dedsav-june-cleanup-july-insert-production.ts --dry-run
 *   npx tsx scripts/fix-dedsav-june-cleanup-july-insert-production.ts --env-file .env.local.backup --allow-production
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

const JUNE_INCOME_ID = "8091b3ef-3f13-43c1-bbad-9bab3bdf493a";
const JUNE_TAX_ID = "51539700-d73d-419d-b0ec-65dcb9766589";
const JUNE_INVOICE = "PAYROLL-DEDSAV-2026-06";
const JULY_INVOICE = "PAYROLL-DEDSAV-2026-07";

const JULY_PAYLOAD = {
  tenant_id: TENANT,
  date: "2026-07-31",
  due_date: "2026-07-31",
  invoice_no: JULY_INVOICE,
  customer_name: "Payroll",
  client_id: null,
  entry_type: "service",
  service_category: "Other Income",
  description:
    "Auto-posted from Payroll July 2026 - Deduction Savings (absence/loan/advance/welfare/other)",
  amount: 85.76,
  amount_received: 0,
  outstanding_balance: 0,
  payment_status: "Unpaid",
  notes:
    "One-time backfill: non-cash payroll deduction savings for period locked before auto-post existed.",
  tax_inclusive: true,
  net_of_tax_amount: 85.76,
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

async function computeJulyGap(admin) {
  const [
    { data: incomeEntries },
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
    admin
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("accounts_payable")
      .select(
        "invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .eq("tenant_id", TENANT),
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
      .select("month, total_net_pay")
      .eq("tenant_id", TENANT),
    admin
      .from("tax_ledger_entries")
      .select(
        "entry_date, period_month, direction, tax_component, tax_amount, status, source_type, source_id",
      )
      .eq("tenant_id", TENANT),
    fetchInventoryBalanceSheetInput(admin, TENANT),
  ]);

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

  return getBalanceCheckForPeriod(report, 6);
}

async function main() {
  const { envFile, allowProduction, dryRun } = parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(`Refusing non-production URL: ${url}`);
  }
  if (!allowProduction && !dryRun) {
    throw new Error("Pass --allow-production to write, or --dry-run to preview.");
  }
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, { auth: { persistSession: false } });

  console.log(dryRun ? "DRY RUN" : "APPLYING PRODUCTION WRITES");
  console.log("Tenant", TENANT);

  const { data: juneIncomeBefore } = await admin
    .from("income_register")
    .select("*")
    .eq("id", JUNE_INCOME_ID)
    .maybeSingle();
  const { data: juneTaxBefore } = await admin
    .from("tax_ledger_entries")
    .select("*")
    .eq("id", JUNE_TAX_ID)
    .maybeSingle();
  const { data: julyBefore } = await admin
    .from("income_register")
    .select("id, invoice_no")
    .eq("tenant_id", TENANT)
    .eq("invoice_no", JULY_INVOICE)
    .maybeSingle();

  console.log("\n--- BEFORE ---");
  console.log("June income:", juneIncomeBefore ? { id: juneIncomeBefore.id, invoice_no: juneIncomeBefore.invoice_no, amount: juneIncomeBefore.amount } : null);
  console.log("June tax:", juneTaxBefore ? { id: juneTaxBefore.id, source_id: juneTaxBefore.source_id, tax_amount: juneTaxBefore.tax_amount } : null);
  console.log("July income already?", julyBefore);

  if (juneTaxBefore && juneTaxBefore.source_id !== JUNE_INCOME_ID) {
    throw new Error(
      `Tax ${JUNE_TAX_ID} source_id ${juneTaxBefore.source_id} != expected ${JUNE_INCOME_ID}`,
    );
  }
  if (juneIncomeBefore && juneIncomeBefore.invoice_no !== JUNE_INVOICE) {
    throw new Error(`June income invoice mismatch: ${juneIncomeBefore.invoice_no}`);
  }
  if (julyBefore) {
    throw new Error(`${JULY_INVOICE} already exists (${julyBefore.id}); refusing insert`);
  }

  if (dryRun) {
    console.log("\nWould delete tax", JUNE_TAX_ID);
    console.log("Would delete income", JUNE_INCOME_ID, JUNE_INVOICE);
    console.log("Would insert July payload:", JULY_PAYLOAD);
    const beforeGap = await computeJulyGap(admin);
    console.log("Current July engine gap:", beforeGap);
    return;
  }

  // PART 1 — tax first, then income
  if (juneTaxBefore) {
    const { error: taxDelErr } = await admin
      .from("tax_ledger_entries")
      .delete()
      .eq("id", JUNE_TAX_ID)
      .eq("tenant_id", TENANT);
    if (taxDelErr) throw new Error(`tax delete failed: ${taxDelErr.message}`);
    console.log("Deleted tax ledger", JUNE_TAX_ID);
  } else {
    console.log("June tax already absent — skip");
  }

  if (juneIncomeBefore) {
    const { error: incomeDelErr } = await admin
      .from("income_register")
      .delete()
      .eq("id", JUNE_INCOME_ID)
      .eq("tenant_id", TENANT);
    if (incomeDelErr) throw new Error(`income delete failed: ${incomeDelErr.message}`);
    console.log("Deleted income", JUNE_INCOME_ID, JUNE_INVOICE);
  } else {
    // Also clear by invoice if id missing but invoice remains
    const { error: byInvErr } = await admin
      .from("income_register")
      .delete()
      .eq("tenant_id", TENANT)
      .eq("invoice_no", JUNE_INVOICE);
    if (byInvErr) throw new Error(`income delete by invoice failed: ${byInvErr.message}`);
    console.log("June income already absent by id — cleared by invoice if any");
  }

  // Also purge any leftover DEDSAV tax by source/notes
  const { error: taxSweepErr } = await admin
    .from("tax_ledger_entries")
    .delete()
    .eq("tenant_id", TENANT)
    .eq("source_type", "income_register")
    .eq("source_id", JUNE_INCOME_ID);
  if (taxSweepErr) throw new Error(`tax sweep failed: ${taxSweepErr.message}`);

  // PART 2 — July insert
  const { data: inserted, error: insertErr } = await admin
    .from("income_register")
    .insert(JULY_PAYLOAD)
    .select("*")
    .single();
  if (insertErr) throw new Error(`July insert failed: ${insertErr.message}`);
  console.log("\nInserted July row id:", inserted.id);

  // VERIFY
  const { data: juneIncomeAfter } = await admin
    .from("income_register")
    .select("id")
    .or(`id.eq.${JUNE_INCOME_ID},invoice_no.eq.${JUNE_INVOICE}`)
    .eq("tenant_id", TENANT);
  const { data: juneTaxAfter } = await admin
    .from("tax_ledger_entries")
    .select("id")
    .or(`id.eq.${JUNE_TAX_ID},source_id.eq.${JUNE_INCOME_ID}`)
    .eq("tenant_id", TENANT);
  const { data: julyAfter } = await admin
    .from("income_register")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("invoice_no", JULY_INVOICE)
    .maybeSingle();

  console.log("\n--- AFTER ---");
  console.log("June income remaining:", juneIncomeAfter);
  console.log("June tax remaining:", juneTaxAfter);
  console.log("July stored row:", JSON.stringify(julyAfter, null, 2));

  const expectedChecks = {
    invoice_no: JULY_INVOICE,
    service_category: "Other Income",
    customer_name: "Payroll",
    client_id: null,
    amount: 85.76,
    amount_received: 0,
    outstanding_balance: 0,
    payment_status: "Unpaid",
    date: "2026-07-31",
    due_date: "2026-07-31",
    tax_inclusive: true,
    net_of_tax_amount: 85.76,
    output_vat_amount: 0,
    output_tax_component: null,
    wht_rate: null,
    wht_amount: 0,
  };

  for (const [key, expected] of Object.entries(expectedChecks)) {
    const actual = julyAfter?.[key];
    const ok =
      actual === expected ||
      (expected === null && (actual === null || actual === undefined)) ||
      (typeof expected === "number" && Number(actual) === expected);
    if (!ok) {
      throw new Error(
        `July shape mismatch on ${key}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`,
      );
    }
  }

  // Ensure no tax ledger was auto-created for July
  const { data: julyTax } = await admin
    .from("tax_ledger_entries")
    .select("id, tax_amount, tax_component")
    .eq("tenant_id", TENANT)
    .eq("source_type", "income_register")
    .eq("source_id", julyAfter.id);
  console.log("July tax ledger legs (should be []):", julyTax);

  const julyGap = await computeJulyGap(admin);
  console.log("\n=== July engine BS check ===");
  console.log(julyGap);
  console.log(`July difference = ${r2(julyGap.difference)} (expect ~86.09)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
