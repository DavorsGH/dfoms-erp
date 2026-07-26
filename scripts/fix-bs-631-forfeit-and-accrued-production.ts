/**
 * PRODUCTION: BS 631.12 fix — forfeit AR reclass + wages_forfeited note.
 *
 * 1. Income ADJ-JUNE-FORFEIT-2026: outstanding_balance → 0 (keep amount 88.09, received 0)
 * 2. PAYROLL-SAL-2026-06 notes → cash_paid=7025.57; wages_forfeited=88.09
 *    so Accrued Wages = net − cash_paid − forfeited = 543.03
 *
 * Usage:
 *   npx tsx scripts/fix-bs-631-forfeit-and-accrued-production.ts --dry-run
 *   npx tsx --env-file .env.local.backup scripts/fix-bs-631-forfeit-and-accrued-production.ts --allow-production
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";
import { mergePayrollWagesSources } from "../app/dashboard/finance/accrued-wages-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import { calculatePayrollLockFinanceTotals } from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";

const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const AUTO_RECEIPT = "PAYROLL-SAL-2026-06";
const FORFEIT_INVOICE = "ADJ-JUNE-FORFEIT-2026";
const FORFEIT_AMOUNT = 88.09;
const BANK_PAID = 7025.57;
const NOTES = `cash_paid=${BANK_PAID}; wages_forfeited=${FORFEIT_AMOUNT}`;

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
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

async function computeBs(admin, label) {
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
        "entry_date, period_month, direction, tax_component, tax_amount, status",
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

  const june = getBalanceCheckForPeriod(report, 5);
  const july = getBalanceCheckForPeriod(report, 6);
  const fy = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
  const cash = report.rows.find((r) => r.label.includes("Cash"));
  const aw = report.rows.find((r) => r.label.includes("Accrued Wages"));
  const ar = report.rows.find((r) => r.label.includes("Accounts Receivable"));
  console.log(`\n=== BS ${label} ===`);
  console.log(
    `gaps: June=${june.difference}  July=${july.difference}  FY=${fy.difference}`,
  );
  console.log(`Cash June/July: ${cash?.amounts[5]} / ${cash?.amounts[6]}`);
  console.log(`AR June/July: ${ar?.amounts[5]} / ${ar?.amounts[6]}`);
  console.log(
    `Accrued Wages June/July: ${aw?.amounts[5]} / ${aw?.amounts[6]}`,
  );
  return { june, july, fy, aw, report, payrollProcessing, expenseEntries };
}

async function main() {
  const { envFile, allowProduction, dryRun } = parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(process.cwd(), envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");

  const projectRef = new URL(url).hostname.split(".")[0];
  if (projectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error(`Refusing non-production ref ${projectRef}`);
  }
  if (!allowProduction && !dryRun) {
    throw new Error("Require --allow-production for writes (or --dry-run)");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: forfeit } = await admin
    .from("income_register")
    .select("id, amount, amount_received, outstanding_balance, description")
    .eq("tenant_id", TENANT)
    .eq("invoice_no", FORFEIT_INVOICE)
    .maybeSingle();
  if (!forfeit) throw new Error("Forfeit income missing");
  if (Number(forfeit.amount) !== FORFEIT_AMOUNT) {
    throw new Error(`Unexpected forfeit amount ${forfeit.amount}`);
  }
  if (Number(forfeit.amount_received) !== 0) {
    throw new Error(`Unexpected amount_received ${forfeit.amount_received}`);
  }
  console.log("Forfeit before:", forfeit);

  const { data: sal } = await admin
    .from("expense_register")
    .select("id, amount, payment_status, notes, receipt_no")
    .eq("tenant_id", TENANT)
    .eq("receipt_no", AUTO_RECEIPT)
    .maybeSingle();
  if (!sal) throw new Error("PAYROLL-SAL missing");
  console.log("PAYROLL-SAL before:", sal);

  const before = await computeBs(admin, "BEFORE");

  // July lock dry-run (never writes)
  const julyRows = (before.payrollProcessing ?? []).filter(
    (r) => String(r.payroll_month).slice(0, 7) === "2026-07",
  );
  const { data: julyFull } = await admin
    .from("payroll_processing")
    .select(
      "gross_pay, net_only_adjustment, employee_ssnit, employer_ssnit, tier2, paye_tax, net_pay",
    )
    .eq("tenant_id", TENANT)
    .eq("payroll_month", "2026-07-01");
  const lockTotals = calculatePayrollLockFinanceTotals(julyFull ?? []);
  const julyGross = Math.round(
    (julyFull ?? []).reduce((s, r) => s + (Number(r.gross_pay) || 0), 0) * 100,
  ) / 100;
  const julyNetOnly = Math.round(
    (julyFull ?? []).reduce(
      (s, r) => s + (Number(r.net_only_adjustment) || 0),
      0,
    ) * 100,
  ) / 100;
  console.log("\n=== July lock dry-run (no write) ===");
  console.log(`July rows=${julyFull?.length} gross=${julyGross} net_only=${julyNetOnly}`);
  console.log("Lock totals:", lockTotals);
  if (lockTotals.totalStaffSalariesExpense !== lockTotals.totalGrossPay) {
    throw new Error(
      "FAIL: Staff Salaries expense still includes net_only_adjustment",
    );
  }
  if (Math.abs(lockTotals.totalNetOnlyAdjustment - julyNetOnly) > 0.05) {
    throw new Error("FAIL: totalNetOnlyAdjustment mismatch");
  }
  console.log(
    "OK: Staff Salaries expense = gross only; net_only_adjustment settles accrual, not re-expensed.",
  );

  // Simulate July locked: inject a synthetic Accrued PAYROLL-SAL-2026-07
  const expensesWithJulyLocked = [
    ...(before.expenseEntries ?? []),
    {
      date: "2026-07-31",
      expense_category: "Staff Salaries",
      sub_category: "Payroll",
      amount: lockTotals.totalStaffSalariesExpense,
      payment_status: "Accrued - Not Yet Paid",
      description: "Auto-posted from Payroll July 2026",
      receipt_no: "PAYROLL-SAL-2026-07",
      notes: null,
    },
  ];
  // Build a mini check using compute path — re-fetch after writes for real AFTER.
  // For dry simulation of accrued after July lock, run inline:
  const {
    calculateAccruedWagesPayableByMonth,
  } = await import("../app/dashboard/finance/accrued-wages-utils");
  const { data: hist } = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay, net_only_adjustment")
    .eq("tenant_id", TENANT);
  const { data: proc } = await admin
    .from("payroll_processing")
    .select("payroll_month, net_pay, net_only_adjustment")
    .eq("tenant_id", TENANT);
  const merged = mergePayrollWagesSources(hist ?? [], proc ?? []);
  // After July lock, July moves to history conceptually — for accrued calc,
  // processing still has July until lock copies it; expense presence is what matters.
  const awSim = calculateAccruedWagesPayableByMonth(
    merged,
    expensesWithJulyLocked.map((e) => ({
      date: e.date,
      expense_category: e.expense_category,
      sub_category: e.sub_category,
      amount: Number(e.amount) || 0,
      payment_status: e.payment_status,
      description: e.description ?? null,
      receipt_no: e.receipt_no ?? null,
      notes: e.notes ?? null,
    })),
    FY,
  );
  console.log(
    `Simulated Accrued Wages after July lock (still unpaid): June=${awSim[5]} July=${awSim[6]}`,
  );
  console.log(
    "(June shortfall should be settled into July's open accrual; June component cleared)",
  );

  if (dryRun) {
    console.log("\nDRY-RUN — would:");
    console.log(`  1. Set forfeit outstanding_balance=0`);
    console.log(`  2. Set PAYROLL-SAL notes=${NOTES}`);
    return;
  }

  if (!allowProduction) throw new Error("Refusing writes");

  const { error: forfeitErr } = await admin
    .from("income_register")
    .update({ outstanding_balance: 0 })
    .eq("tenant_id", TENANT)
    .eq("id", forfeit.id)
    .eq("invoice_no", FORFEIT_INVOICE);
  if (forfeitErr) throw forfeitErr;
  console.log("Updated forfeit outstanding_balance=0");

  const { error: notesErr } = await admin
    .from("expense_register")
    .update({ notes: NOTES })
    .eq("tenant_id", TENANT)
    .eq("id", sal.id)
    .eq("receipt_no", AUTO_RECEIPT);
  if (notesErr) throw notesErr;
  console.log(`Updated PAYROLL-SAL notes=${NOTES}`);

  const after = await computeBs(admin, "AFTER");

  const expectedGaps = { june: 38, july: -2, fy: -40 };
  const tol = 0.05;
  if (Math.abs(after.june.difference - expectedGaps.june) > tol) {
    throw new Error(
      `June gap ${after.june.difference} != expected ${expectedGaps.june}`,
    );
  }
  if (Math.abs(after.july.difference - expectedGaps.july) > tol) {
    throw new Error(
      `July gap ${after.july.difference} != expected ${expectedGaps.july}`,
    );
  }
  if (Math.abs(after.fy.difference - expectedGaps.fy) > tol) {
    throw new Error(
      `FY gap ${after.fy.difference} != expected ${expectedGaps.fy}`,
    );
  }
  if (Math.abs((after.aw?.amounts[5] ?? 0) - 543.03) > tol) {
    throw new Error(
      `June Accrued Wages ${after.aw?.amounts[5]} != expected 543.03`,
    );
  }

  const { data: verifyForfeit } = await admin
    .from("income_register")
    .select("amount, amount_received, outstanding_balance")
    .eq("tenant_id", TENANT)
    .eq("invoice_no", FORFEIT_INVOICE)
    .maybeSingle();
  console.log("Verify forfeit:", verifyForfeit);

  console.log("\nDONE. July remains Open — David locks when ready.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
