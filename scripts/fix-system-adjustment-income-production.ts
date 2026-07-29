/**
 * PRODUCTION (run ONLY after staging Steps 1–2 + 4 pass):
 * Correct mis-shaped non-cash adjustment income rows:
 *   - ADJ-JUNE-FORFEIT-2026 (id 99e34c23-…)
 *   - PAYROLL-DEDSAV-2026-07
 *
 * Sets outstanding_balance=0, clears VAT/WHT columns, sets is_system_adjustment,
 * deletes linked tax_ledger_entries. Does NOT change amount.
 *
 *   npx tsx scripts/fix-system-adjustment-income-production.ts --dry-run
 *   npx tsx scripts/fix-system-adjustment-income-production.ts --env-file .env.local.backup --allow-production
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { mergePayrollWagesSources } from "../app/dashboard/finance/accrued-wages-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;

const TARGETS = [
  {
    id: "99e34c23-7069-488e-aa70-074336c9e074",
    invoice_no: "ADJ-JUNE-FORFEIT-2026",
    amount: 88.09,
    service_category: "Other Income",
    customer_name: null,
    client_id: null,
    notes:
      "Forfeited June wage shortfall for terminated/inactive staff; non-cash P&L income.",
  },
  {
    id: null, // resolve by invoice
    invoice_no: "PAYROLL-DEDSAV-2026-07",
    amount: 87.32,
    service_category: "Other Income",
    customer_name: "Payroll",
    client_id: null,
    notes:
      "Non-cash payroll deduction savings (absence/loan/advance/welfare/other); auto-posted on payroll lock.",
  },
];

function loadEnvForce(filePath) {
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

function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parseArgs(argv) {
  let envFile = ".env.local.backup";
  let allowProduction = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--allow-production") allowProduction = true;
    else if (argv[i] === "--env-file") envFile = argv[++i] ?? envFile;
  }
  return { envFile, allowProduction, dryRun };
}

async function applyMigration126(projectRef) {
  const password =
    process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? "";
  const enc = encodeURIComponent(password);
  const urls = [
    process.env.DATABASE_URL,
    `postgresql://postgres.${projectRef}:${enc}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.${projectRef}:${enc}@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true`,
  ].filter(Boolean);
  const sql = readFileSync(
    resolve("scripts/126_income_register_system_adjustment.sql"),
    "utf8",
  );
  let lastErr = null;
  for (const url of urls) {
    const client = new pg.Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      await client.query(sql);
      await client.end();
      console.log("Applied 126 via postgres");
      return true;
    } catch (err) {
      lastErr = err;
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  console.warn("Could not apply 126 via postgres:", lastErr?.message);
  return false;
}

async function computeGaps(admin) {
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
      .select("month, total_net_pay")
      .eq("tenant_id", TENANT),
    admin.from("tax_ledger_entries").select("*").eq("tenant_id", TENANT),
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
  assert(url.includes(PRODUCTION_REF), `Refusing non-production: ${url}`);
  assert(key, "Missing service role");
  if (!dryRun && !allowProduction) {
    throw new Error("Pass --allow-production (or --dry-run)");
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });

  console.log("=== BEFORE gaps ===");
  const before = await computeGaps(admin);
  console.log("June", before.june);
  console.log("July", before.july);

  if (!dryRun) {
    const applied = await applyMigration126(PRODUCTION_REF);
    if (!applied) {
      console.warn(
        "WARNING: DDL not applied — continuing row fixes only if column already exists",
      );
    }
  }

  for (const target of TARGETS) {
    const { data: row, error } = await admin
      .from("income_register")
      .select("*")
      .eq("tenant_id", TENANT)
      .eq("invoice_no", target.invoice_no)
      .maybeSingle();
    assert(!error, error?.message ?? "load failed");
    assert(row, `Missing ${target.invoice_no}`);
    if (target.id) {
      assert(row.id === target.id, `id mismatch for ${target.invoice_no}`);
    }
    assert(
      almost(row.amount, target.amount),
      `${target.invoice_no} amount ${row.amount} != ${target.amount}`,
    );

    console.log(`\n--- ${target.invoice_no} BEFORE ---`, {
      id: row.id,
      amount: row.amount,
      outstanding: row.outstanding_balance,
      vat: row.output_vat_amount,
      wht: row.wht_amount,
      category: row.service_category,
      client_id: row.client_id,
      flag: row.is_system_adjustment,
    });

    const { data: taxBefore } = await admin
      .from("tax_ledger_entries")
      .select("id, tax_component, tax_amount")
      .eq("source_type", "income_register")
      .eq("source_id", row.id);
    console.log("tax rows before", taxBefore);

    if (dryRun) continue;

    const { error: updErr } = await admin
      .from("income_register")
      .update({
        outstanding_balance: 0,
        amount_received: 0,
        output_vat_amount: 0,
        output_tax_component: null,
        wht_rate: null,
        wht_amount: 0,
        net_of_tax_amount: target.amount,
        tax_inclusive: true,
        is_system_adjustment: true,
        service_category: target.service_category,
        customer_name: target.customer_name,
        client_id: target.client_id,
        notes: target.notes,
        payment_status: "Unpaid",
      })
      .eq("id", row.id);
    assert(!updErr, updErr?.message ?? "update failed");

    const { error: delTaxErr } = await admin
      .from("tax_ledger_entries")
      .delete()
      .eq("source_type", "income_register")
      .eq("source_id", row.id);
    assert(!delTaxErr, delTaxErr?.message ?? "tax delete failed");

    const { data: after } = await admin
      .from("income_register")
      .select("*")
      .eq("id", row.id)
      .single();
    const { data: taxAfter } = await admin
      .from("tax_ledger_entries")
      .select("id")
      .eq("source_type", "income_register")
      .eq("source_id", row.id);

    console.log(`--- ${target.invoice_no} AFTER ---`, {
      amount: after.amount,
      outstanding: after.outstanding_balance,
      vat: after.output_vat_amount,
      wht: after.wht_amount,
      net: after.net_of_tax_amount,
      flag: after.is_system_adjustment,
      category: after.service_category,
      taxRows: taxAfter?.length ?? 0,
    });
    assert(almost(after.amount, target.amount), "amount must be unchanged");
    assert(almost(after.outstanding_balance, 0), "OB must be 0");
    assert(almost(after.output_vat_amount, 0), "VAT must be 0");
    assert((taxAfter ?? []).length === 0, "tax rows must be gone");
  }

  if (!dryRun) {
    console.log("\n=== AFTER gaps ===");
    const afterGaps = await computeGaps(admin);
    console.log("June", afterGaps.june);
    console.log("July", afterGaps.july);
    console.log(
      "Expected July ~ -2.00 (inventory +38 and product-purchase lag -40); was 155.79",
    );
  } else {
    console.log("\nDRY RUN — no writes");
  }
}

function almost(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
