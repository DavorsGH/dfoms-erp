/**
 * PRODUCTION: June 2026 staff salaries expense + clear Accrued Wages.
 *
 * Fix 1: PAYROLL-SAL-2026-06 amount 8369.77 → 8124.83 (gross − absence).
 * Fix 2: Mark that accrual Paid so Accrued Wages Payable clears.
 *         Delete duplicate cash "Staff June Salary" 7025.57 so P&L/cash are
 *         not double-counted. BS cash for Paid PAYROLL-SAL uses payroll net
 *         (see cash-movement-utils staffSalaryNetByPayrollMonth) so
 *         Dr Accrued Wages / Cr Cash stays balanced.
 *
 * Requires the BS cash=net code change to be deployed for the dashboard to
 * show the same balanced result as this script (which imports local utils).
 *
 * Usage:
 *   npx tsx scripts/fix-june-2026-staff-salaries-accrued-wages-production.ts --dry-run
 *   npx tsx scripts/fix-june-2026-staff-salaries-accrued-wages-production.ts --env-file .env.local.backup --allow-production
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  FULL_YEAR_INDEX,
  type BalanceSheetAccountsPayableEntry,
  type BalanceSheetIncomeEntry,
  type BalanceSheetTaxLedgerEntry,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  mergePayrollWagesSources,
  calculateAccruedWagesPayableByMonth,
  isAccruedStaffSalariesExpense,
  isStaffSalariesExpenseEntry,
  type BalanceSheetCashExpenseEntry,
  type MonthEndCloseNetPayEntry,
  type PayrollHistoryWagesEntry,
} from "../app/dashboard/finance/accrued-wages-utils";
import type { CapitalContributionEntry } from "../app/dashboard/finance/capital-contributions-utils";
import type { ManualFinancialEntry } from "../app/dashboard/finance/cash-flow-utils";
import type {
  ProfitLossAssetEntry,
  ProfitLossExpenseEntry,
} from "../app/dashboard/finance/profit-loss-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";

const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;

const AUTO_RECEIPT = "PAYROLL-SAL-2026-06";
const AUTO_OLD_AMOUNT = 8369.77;
const AUTO_NEW_AMOUNT = 8124.83; // 8369.77 - 244.94 absence
const MANUAL_PAID_AMOUNT = 7025.57;
const MANUAL_DESC = "Staff June Salary";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

function parseArgs(argv: string[]) {
  let envFile = ".env.local.backup";
  let allowProduction = false;
  let dryRun = false;
  let keepManualPaid = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--allow-production") allowProduction = true;
    else if (arg === "--keep-manual-paid") keepManualPaid = true;
    else if (arg === "--env-file") envFile = argv[++i] ?? envFile;
  }
  return { envFile, allowProduction, dryRun, keepManualPaid };
}

async function computeBs(admin: SupabaseClient, label: string) {
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
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, net_of_tax_amount, input_vat_amount",
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
      .select("payroll_month, net_pay")
      .eq("tenant_id", TENANT),
    admin
      .from("payroll_processing")
      .select("payroll_month, net_pay")
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

  const cashFlowExpenseEntries = (expenseEntries ?? []).map((entry) => ({
    date: entry.date,
    expense_category: entry.expense_category,
    sub_category: entry.sub_category,
    amount: Number(entry.amount) || 0,
    payment_status: entry.payment_status,
    description: entry.description ?? null,
    receipt_no: entry.receipt_no ?? null,
  })) as BalanceSheetCashExpenseEntry[];

  const report = buildBalanceSheetReport(
    (incomeEntries ?? []) as BalanceSheetIncomeEntry[],
    (expenseEntries ?? []) as ProfitLossExpenseEntry[],
    (fixedAssets ?? []) as ProfitLossAssetEntry[],
    (payableEntries ?? []) as BalanceSheetAccountsPayableEntry[],
    (capitalContributions as CapitalContributionEntry[] | null) ?? [],
    cashFlowExpenseEntries,
    mergePayrollWagesSources(
      (payrollHistory as PayrollHistoryWagesEntry[] | null) ?? [],
      (payrollProcessing as PayrollHistoryWagesEntry[] | null) ?? [],
    ),
    (monthEndCloseRecords as MonthEndCloseNetPayEntry[] | null) ?? [],
    FY,
    inventoryBalanceSheet,
    (manualEntries as ManualFinancialEntry[] | null) ?? [],
    (taxLedgerEntries as BalanceSheetTaxLedgerEntry[] | null) ?? [],
  );

  const accrued = calculateAccruedWagesPayableByMonth(
    mergePayrollWagesSources(
      (payrollHistory as PayrollHistoryWagesEntry[] | null) ?? [],
      (payrollProcessing as PayrollHistoryWagesEntry[] | null) ?? [],
    ),
    cashFlowExpenseEntries,
    FY,
    (monthEndCloseRecords as MonthEndCloseNetPayEntry[] | null) ?? [],
  );

  const june = getBalanceCheckForPeriod(report, 5);
  const july = getBalanceCheckForPeriod(report, 6);
  const fy = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);

  console.log(`\n=== BS ${label} ===`);
  console.log(
    `June: assets=${june.totalAssets} L+E=${june.totalLiabilitiesAndEquity} gap=${june.difference} balanced=${june.isBalanced}`,
  );
  console.log(
    `July: assets=${july.totalAssets} L+E=${july.totalLiabilitiesAndEquity} gap=${july.difference} balanced=${july.isBalanced}`,
  );
  console.log(
    `FY:   assets=${fy.totalAssets} L+E=${fy.totalLiabilitiesAndEquity} gap=${fy.difference} balanced=${fy.isBalanced}`,
  );
  console.log(`Accrued Wages June/July/Dec: ${accrued[5]} / ${accrued[6]} / ${accrued[11]}`);

  const cashRow = report.rows.find((r) => r.label.includes("Cash"));
  const awRow = report.rows.find((r) => r.label.includes("Accrued Wages"));
  const reRow = report.rows.find((r) => r.label.includes("Retained Earnings"));
  console.log(`Cash June/July: ${cashRow?.amounts[5]} / ${cashRow?.amounts[6]}`);
  console.log(`Accrued Wages line June/July: ${awRow?.amounts[5]} / ${awRow?.amounts[6]}`);
  console.log(`RE June/July: ${reRow?.amounts[5]} / ${reRow?.amounts[6]}`);

  return { june, july, fy, accrued };
}

async function main() {
  const { envFile, allowProduction, dryRun, keepManualPaid } = parseArgs(
    process.argv.slice(2),
  );
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
  if (!allowProduction && dryRun) {
    console.log("DRY-RUN on production (read-only OK without --allow-production)");
  }
  if (allowProduction && dryRun) {
    console.log("DRY-RUN with --allow-production (still no writes)");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Locate target rows
  const { data: autoRows, error: autoErr } = await admin
    .from("expense_register")
    .select(
      "id, tenant_id, date, amount, payment_status, payment_method, description, receipt_no, expense_category, sub_category",
    )
    .eq("tenant_id", TENANT)
    .eq("receipt_no", AUTO_RECEIPT);
  if (autoErr) throw autoErr;
  if (!autoRows || autoRows.length !== 1) {
    throw new Error(`Expected 1 auto SAL row, found ${autoRows?.length ?? 0}`);
  }
  const auto = autoRows[0];
  if (Number(auto.amount) !== AUTO_OLD_AMOUNT) {
    throw new Error(
      `Auto amount ${auto.amount} !== expected ${AUTO_OLD_AMOUNT} — aborting`,
    );
  }
  if (String(auto.payment_status) !== "Accrued - Not Yet Paid") {
    throw new Error(
      `Auto status "${auto.payment_status}" !== Accrued - Not Yet Paid — aborting`,
    );
  }

  const { data: manualRows, error: manualErr } = await admin
    .from("expense_register")
    .select(
      "id, tenant_id, date, amount, payment_status, description, receipt_no, expense_category, sub_category",
    )
    .eq("tenant_id", TENANT)
    .eq("description", MANUAL_DESC)
    .eq("amount", MANUAL_PAID_AMOUNT);
  if (manualErr) throw manualErr;
  if (!manualRows || manualRows.length !== 1) {
    throw new Error(
      `Expected 1 manual "${MANUAL_DESC}" @ ${MANUAL_PAID_AMOUNT}, found ${manualRows?.length ?? 0}`,
    );
  }
  const manual = manualRows[0];
  if (String(manual.payment_status) !== "Paid") {
    throw new Error(`Manual status "${manual.payment_status}" !== Paid — aborting`);
  }

  console.log("Targets:");
  console.log(
    `  AUTO id=${auto.id} amt=${auto.amount} status=${auto.payment_status} receipt=${auto.receipt_no}`,
  );
  console.log(
    `  MANUAL id=${manual.id} amt=${manual.amount} status=${manual.payment_status} desc=${manual.description}`,
  );
  console.log(
    `Plan: auto ${AUTO_OLD_AMOUNT}→${AUTO_NEW_AMOUNT} + status Paid` +
      (keepManualPaid
        ? "; KEEP manual paid (double-count risk)"
        : `; DELETE manual ${MANUAL_PAID_AMOUNT} (avoid double cash/P&L)`),
  );

  const before = await computeBs(admin, "BEFORE");

  // In-memory simulation of the planned writes (always, so dry-run can preview).
  {
    const { data: allExpenses } = await admin
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", TENANT);
    const simulated = (allExpenses ?? [])
      .filter((e) => {
        if (keepManualPaid) return true;
        return !(
          e.description === MANUAL_DESC &&
          Number(e.amount) === MANUAL_PAID_AMOUNT
        );
      })
      .map((e) => {
        if (e.receipt_no === AUTO_RECEIPT) {
          return {
            ...e,
            amount: AUTO_NEW_AMOUNT,
            payment_status: "Paid",
          };
        }
        return e;
      });

    const [
      { data: incomeEntries },
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
        .select("payroll_month, net_pay")
        .eq("tenant_id", TENANT),
      admin
        .from("payroll_processing")
        .select("payroll_month, net_pay")
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

    const cashFlowExpenseEntries = simulated.map((entry) => ({
      date: entry.date,
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      amount: Number(entry.amount) || 0,
      payment_status: entry.payment_status,
      description: entry.description ?? null,
      receipt_no: entry.receipt_no ?? null,
    })) as BalanceSheetCashExpenseEntry[];

    const report = buildBalanceSheetReport(
      (incomeEntries ?? []) as BalanceSheetIncomeEntry[],
      simulated as ProfitLossExpenseEntry[],
      (fixedAssets ?? []) as ProfitLossAssetEntry[],
      (payableEntries ?? []) as BalanceSheetAccountsPayableEntry[],
      (capitalContributions as CapitalContributionEntry[] | null) ?? [],
      cashFlowExpenseEntries,
      mergePayrollWagesSources(
        (payrollHistory as PayrollHistoryWagesEntry[] | null) ?? [],
        (payrollProcessing as PayrollHistoryWagesEntry[] | null) ?? [],
      ),
      (monthEndCloseRecords as MonthEndCloseNetPayEntry[] | null) ?? [],
      FY,
      inventoryBalanceSheet,
      (manualEntries as ManualFinancialEntry[] | null) ?? [],
      (taxLedgerEntries as BalanceSheetTaxLedgerEntry[] | null) ?? [],
    );
    const accrued = calculateAccruedWagesPayableByMonth(
      mergePayrollWagesSources(
        (payrollHistory as PayrollHistoryWagesEntry[] | null) ?? [],
        (payrollProcessing as PayrollHistoryWagesEntry[] | null) ?? [],
      ),
      cashFlowExpenseEntries,
      FY,
      (monthEndCloseRecords as MonthEndCloseNetPayEntry[] | null) ?? [],
    );
    const july = getBalanceCheckForPeriod(report, 6);
    const fy = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
    const cashRow = report.rows.find((r) => r.label.includes("Cash"));
    console.log("\n=== BS SIMULATED (in-memory) ===");
    console.log(
      `July: assets=${july.totalAssets} L+E=${july.totalLiabilitiesAndEquity} gap=${july.difference} balanced=${july.isBalanced}`,
    );
    console.log(
      `FY:   assets=${fy.totalAssets} L+E=${fy.totalLiabilitiesAndEquity} gap=${fy.difference} balanced=${fy.isBalanced}`,
    );
    console.log(`Accrued Wages June/July: ${accrued[5]} / ${accrued[6]}`);
    console.log(`Cash June/July: ${cashRow?.amounts[5]} / ${cashRow?.amounts[6]}`);
    console.log(
      `July gap vs before: ${before.july.difference} → ${july.difference}`,
    );
  }

  if (dryRun) {
    console.log("\nDRY-RUN — no writes. Apply with --allow-production (without --dry-run).");
    return;
  }

  // --- WRITE Fix 1 + Fix 2 on auto row ---
  const { data: updatedAuto, error: updErr } = await admin
    .from("expense_register")
    .update({
      amount: AUTO_NEW_AMOUNT,
      payment_status: "Paid",
    })
    .eq("tenant_id", TENANT)
    .eq("id", auto.id)
    .eq("receipt_no", AUTO_RECEIPT)
    .eq("amount", AUTO_OLD_AMOUNT)
    .select("id, amount, payment_status, receipt_no")
    .maybeSingle();
  if (updErr) throw updErr;
  if (!updatedAuto) throw new Error("Auto update matched 0 rows");
  if (Number(updatedAuto.amount) !== AUTO_NEW_AMOUNT) {
    throw new Error(`Auto update amount mismatch: ${updatedAuto.amount}`);
  }
  if (updatedAuto.payment_status !== "Paid") {
    throw new Error(`Auto update status mismatch: ${updatedAuto.payment_status}`);
  }
  console.log("\nUPDATED auto:", updatedAuto);

  if (!keepManualPaid) {
    const { error: delErr, count } = await admin
      .from("expense_register")
      .delete({ count: "exact" })
      .eq("tenant_id", TENANT)
      .eq("id", manual.id)
      .eq("amount", MANUAL_PAID_AMOUNT)
      .eq("description", MANUAL_DESC);
    if (delErr) throw delErr;
    if (count !== 1) throw new Error(`Manual delete matched ${count} rows`);
    console.log(`DELETED manual ${manual.id} (${MANUAL_PAID_AMOUNT})`);
  }

  // Verify keep-targets
  const { data: essnit } = await admin
    .from("expense_register")
    .select("id, amount, payment_status, receipt_no")
    .eq("tenant_id", TENANT)
    .eq("receipt_no", "PAYROLL-ESSNIT-2026-06")
    .maybeSingle();
  console.log("Employer SSNIT auto (untouched):", essnit);

  const { data: salAfter } = await admin
    .from("expense_register")
    .select("id, amount, payment_status, receipt_no, description")
    .eq("tenant_id", TENANT)
    .eq("receipt_no", AUTO_RECEIPT)
    .maybeSingle();
  console.log("Staff Salaries auto after:", salAfter);

  const { data: manualGone } = await admin
    .from("expense_register")
    .select("id")
    .eq("id", manual.id)
    .maybeSingle();
  if (!keepManualPaid && manualGone) {
    throw new Error("Manual row still present after delete");
  }

  const after = await computeBs(admin, "AFTER");

  console.log("\n=== Summary ===");
  console.log(
    `July gap: ${before.july.difference} → ${after.july.difference} (Δ ${r2(after.july.difference - before.july.difference)})`,
  );
  console.log(
    `FY gap:   ${before.fy.difference} → ${after.fy.difference} (Δ ${r2(after.fy.difference - before.fy.difference)})`,
  );
  console.log(
    `Accrued Wages June: ${before.accrued[5]} → ${after.accrued[5]}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
