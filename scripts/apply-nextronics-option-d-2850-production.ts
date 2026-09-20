/**
 * PRODUCTION: Nextronics Option D — +2,850 GHS prior-period inventory true-up.
 *
 *   npx tsx scripts/apply-nextronics-option-d-2850-production.ts --dry-run
 *   npx tsx scripts/apply-nextronics-option-d-2850-production.ts --allow-production
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";
import { detectAutoPostedIncomeRegisterEntry } from "../app/dashboard/finance/register-auto-posted-utils";
import { isInventoryGoLiveTrueUpExpense } from "../app/dashboard/finance/register-auto-posted-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "da8b968e-dd42-48d5-93c5-a3147ff5de72";
const TENANT_NAME = "Nextronics World";
const FY = 2026;
const GAP = 2850;
const INCOME_INVOICE = "ADJ-PPIR-2026-06";
const EXPENSE_RECEIPT = "ADJ-PPIR-REV-2026-08";

const INCOME_PAYLOAD = {
  tenant_id: TENANT,
  date: "2026-06-01",
  due_date: "2026-06-01",
  invoice_no: INCOME_INVOICE,
  customer_name: null,
  client_id: null,
  entry_type: "service",
  service_category: "Other Income",
  description:
    "Prior-Period Inventory Recognition — inventory cost consumed by Jun 2026 product sales before inventory go-live (2026-08-05)",
  amount: GAP,
  amount_received: 0,
  outstanding_balance: 0,
  payment_status: "Non-Cash",
  notes:
    "Non-cash system adjustment: pre-go-live COGS consumed untracked inventory (Option D true-up). Paired with ADJ-PPIR-REV-2026-08.",
  tax_inclusive: true,
  net_of_tax_amount: GAP,
  output_vat_amount: 0,
  output_tax_component: null,
  wht_rate: null,
  wht_amount: 0,
  is_system_adjustment: true,
};

const EXPENSE_PAYLOAD = {
  tenant_id: TENANT,
  date: "2026-08-05",
  expense_category: "Other Expenses",
  sub_category: "Inventory Go-Live True-Up",
  description:
    "Reversal of ADJ-PPIR-2026-06 — inventory asset tracking active from go-live; Jun COGS already netted in valuation history",
  vendor: "Internal",
  price: GAP,
  quantity: 1,
  amount: GAP,
  payment_method: "Internal",
  approved_by: "System",
  receipt_no: EXPENSE_RECEIPT,
  payment_status: "Non-Cash",
  notes:
    "Non-cash reversal of ADJ-PPIR-2026-06 at inventory go-live. Do not edit or delete.",
};

function loadEnv(filePath: string) {
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

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function parseArgs() {
  let dryRun = false;
  let allowProduction = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") dryRun = true;
    if (arg === "--allow-production") allowProduction = true;
  }
  return { dryRun, allowProduction };
}

async function buildLiveReport(admin) {
  const data = await fetchBalanceSheetPageData(admin, TENANT);
  const liveBundle = await fetchPayrollLiveRecalcBundle(admin, { tenantId: TENANT });
  const payrollHistory = mergePayrollWagesWithLiveOpenMonths(
    data.initialPayrollHistory,
    data.initialPayrollProcessingRows,
    liveBundle.employees,
    liveBundle.liveContext,
  );
  const cashFlowExpenseEntries = data.initialExpenseEntries.map((entry) => ({
    date: entry.date,
    expense_category: entry.expense_category,
    sub_category: entry.sub_category,
    amount: entry.amount,
    payment_status: entry.payment_status,
    description: entry.description ?? null,
    receipt_no: entry.receipt_no ?? null,
    notes: entry.notes ?? null,
  }));

  return buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    cashFlowExpenseEntries,
    payrollHistory,
    data.initialMonthEndCloseNetPay,
    FY,
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    {
      tenantId: TENANT,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );
}

function monthMetrics(report, idx: number) {
  const check = getBalanceCheckForPeriod(report, idx);
  const row = (key: string) =>
    r2(getBalanceSheetAmountForMonth(report.rows.find((r) => r.key === key)!, idx));
  return {
    month: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"][idx],
    diff: r2(check.difference),
    balanced: check.isBalanced,
    total_assets: r2(check.totalAssets),
    total_le: r2(check.totalLiabilitiesAndEquity),
    cash: row("cash"),
    inventory: row("inventory"),
    retained_earnings: row("retained-earnings"),
  };
}

async function main() {
  const { dryRun, allowProduction } = parseArgs();
  loadEnv(resolve(".env.local.backup"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(`Refusing non-production URL: ${url}`);
  }
  if (!dryRun && !allowProduction) {
    throw new Error("Pass --allow-production to write, or --dry-run to preview.");
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  console.log(`${dryRun ? "DRY RUN" : "APPLY"} | ${TENANT_NAME} | Option D +${GAP} GHS`);

  const baselineReport = await buildLiveReport(admin);
  const baseline = {
    jun: monthMetrics(baselineReport, 5),
    jul: monthMetrics(baselineReport, 6),
    aug: monthMetrics(baselineReport, 7),
    sep: monthMetrics(baselineReport, 8),
  };
  console.log("\n=== BASELINE (before) ===");
  console.log(baseline);

  const { data: existingIncome } = await admin
    .from("income_register")
    .select("id, amount, is_system_adjustment")
    .eq("tenant_id", TENANT)
    .eq("invoice_no", INCOME_INVOICE)
    .maybeSingle();
  const { data: existingExpense } = await admin
    .from("expense_register")
    .select("id, amount, receipt_no")
    .eq("tenant_id", TENANT)
    .eq("receipt_no", EXPENSE_RECEIPT)
    .maybeSingle();

  console.log("\n=== Existing rows ===");
  console.log({ existingIncome, existingExpense });

  if (dryRun) {
    console.log("\nWould insert/update:");
    console.log("Income:", INCOME_PAYLOAD);
    console.log("Expense:", EXPENSE_PAYLOAD);
    return;
  }

  let incomeRow = existingIncome;
  if (!incomeRow) {
    const { data: inserted, error } = await admin
      .from("income_register")
      .insert(INCOME_PAYLOAD)
      .select("id, invoice_no, amount, is_system_adjustment, outstanding_balance, amount_received")
      .single();
    if (error) throw error;
    incomeRow = inserted;
    console.log("\nInserted income:", incomeRow);
  } else {
    const { data: updated, error } = await admin
      .from("income_register")
      .update({
        date: INCOME_PAYLOAD.date,
        due_date: INCOME_PAYLOAD.due_date,
        service_category: INCOME_PAYLOAD.service_category,
        description: INCOME_PAYLOAD.description,
        amount: INCOME_PAYLOAD.amount,
        amount_received: 0,
        outstanding_balance: 0,
        payment_status: INCOME_PAYLOAD.payment_status,
        notes: INCOME_PAYLOAD.notes,
        net_of_tax_amount: INCOME_PAYLOAD.net_of_tax_amount,
        output_vat_amount: 0,
        wht_amount: 0,
        is_system_adjustment: true,
      })
      .eq("id", incomeRow.id)
      .select("id, invoice_no, amount, is_system_adjustment, outstanding_balance, amount_received")
      .single();
    if (error) throw error;
    incomeRow = updated;
    console.log("\nUpdated existing income:", incomeRow);
  }

  const incomeLock = detectAutoPostedIncomeRegisterEntry(incomeRow);
  if (!incomeLock.autoPosted) {
    throw new Error("Income row not detected as system adjustment — protection missing");
  }

  const { data: incomeTax } = await admin
    .from("tax_ledger_entries")
    .select("id")
    .eq("tenant_id", TENANT)
    .eq("source_type", "income_register")
    .eq("source_id", incomeRow.id);
  if ((incomeTax ?? []).length > 0) {
    throw new Error(`Unexpected tax legs on income row: ${JSON.stringify(incomeTax)}`);
  }

  let expenseRow = existingExpense;
  if (!expenseRow) {
    const { data: inserted, error } = await admin
      .from("expense_register")
      .insert(EXPENSE_PAYLOAD)
      .select("id, receipt_no, amount, payment_status")
      .single();
    if (error) throw error;
    expenseRow = inserted;
    console.log("\nInserted expense:", expenseRow);
  } else {
    const { data: updated, error } = await admin
      .from("expense_register")
      .update({
        date: EXPENSE_PAYLOAD.date,
        expense_category: EXPENSE_PAYLOAD.expense_category,
        sub_category: EXPENSE_PAYLOAD.sub_category,
        description: EXPENSE_PAYLOAD.description,
        amount: EXPENSE_PAYLOAD.amount,
        payment_status: EXPENSE_PAYLOAD.payment_status,
        notes: EXPENSE_PAYLOAD.notes,
      })
      .eq("id", expenseRow.id)
      .select("id, receipt_no, amount, payment_status")
      .single();
    if (error) throw error;
    expenseRow = updated;
    console.log("\nUpdated existing expense:", expenseRow);
  }

  if (!isInventoryGoLiveTrueUpExpense(expenseRow)) {
    throw new Error("Expense row receipt_no not recognized as ADJ-PPIR protection pattern");
  }

  const afterReport = await buildLiveReport(admin);
  const after = {
    jun: monthMetrics(afterReport, 5),
    jul: monthMetrics(afterReport, 6),
    aug: monthMetrics(afterReport, 7),
    sep: monthMetrics(afterReport, 8),
  };
  console.log("\n=== AFTER (live production) ===");
  console.log(after);

  const checks = [
    ["Jun diff = 0", after.jun.diff === 0],
    ["Jul diff = 0", after.jul.diff === 0],
    ["Aug diff = 0", after.aug.diff === 0],
    ["Sep diff = 0", after.sep.diff === 0],
    ["Aug cash unchanged", after.aug.cash === baseline.aug.cash],
    ["Aug inventory unchanged", after.aug.inventory === baseline.aug.inventory],
    ["Sep cash unchanged", after.sep.cash === baseline.sep.cash],
    ["Sep inventory unchanged", after.sep.inventory === baseline.sep.inventory],
    ["Aug RE unchanged", after.aug.retained_earnings === baseline.aug.retained_earnings],
    ["Sep RE unchanged", after.sep.retained_earnings === baseline.sep.retained_earnings],
  ];

  console.log("\n=== VERIFICATION ===");
  let allPass = true;
  for (const [label, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
    if (!ok) allPass = false;
  }

  if (!allPass) {
    throw new Error("Post-apply verification failed — review AFTER vs BASELINE above");
  }

  console.log("\nSUCCESS: Option D applied and verified on production.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
