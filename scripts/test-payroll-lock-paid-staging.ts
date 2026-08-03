/**
 * Staging verification: permanent Lock Paid-on-SAL + cash / Accrued Wages /
 * Partial Lock Accrued / double-post guard / Release reverse (scenarios a–f).
 *
 * Usage:
 *   npx tsx scripts/test-payroll-lock-paid-staging.ts
 *   npx tsx scripts/test-payroll-lock-paid-staging.ts --env-file .env.staging.local
 *
 * STAGING ONLY — refuses production project refs.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  calculateAccruedWagesPayableByMonth,
  mergePayrollWagesSources,
} from "../app/dashboard/finance/accrued-wages-utils";
import { buildMonthlyCashComponents } from "../app/dashboard/finance/cash-movement-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  deletePayrollLockFinanceEntries,
  PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
  PAYROLL_EXPENSE_PAYMENT_STATUS_PAID,
  postPayrollLockFinanceEntries,
  resolvePayrollLockFinancePeriod,
  type PayrollLockFinanceSourceRow,
} from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";
import { isFullMonthPayrollLock } from "../app/dashboard/hr-payroll/payroll-period-utils";

function loadEnvForce(filePath: string) {
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

function resolveEnvFile(argv: string[]) {
  const idx = argv.indexOf("--env-file");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return ".env.staging.local";
}

loadEnvForce(resolve(resolveEnvFile(process.argv.slice(2))));

const PRODUCTION_PROJECT_REFS = new Set(["tvcurcnmasnocwdxzgvz"]);
const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";

const DAVORS = "00000001-0000-4000-8000-000000000001";
/** Use FY matching expense date year so cash/accrued land in March bucket. */
const FY = 2099;
const TEST_MONTH = "2099-03-01";
const TEST_PERIOD_KEY = "2099-03";
const TEST_YEAR = 2099;
const TEST_MONTH_NUM = 3;
const TEST_EMPLOYEE = "DF-EMP-0006";
const SAL_RECEIPT = `PAYROLL-SAL-${TEST_PERIOD_KEY}`;
const ESSNIT_RECEIPT = `PAYROLL-ESSNIT-${TEST_PERIOD_KEY}`;
const GROSS = 1000;
/** net = gross − employee_ssnit − paye (keeps Accrued lock BS-balanced). */
const NET_PAY = 930;
const EMPLOYER_SSNIT = 50;
const TIER2 = 10;

type Result = { name: string; ok: boolean; detail: string };

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function log(step: string) {
  console.log(`[lock-paid] ${step}`);
}

function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(host);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function fetchPayrollWages(admin: ReturnType<typeof createClient>) {
  const preferred = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay, net_only_adjustment")
    .eq("tenant_id", DAVORS);
  if (
    preferred.error &&
    String(preferred.error.message).includes("net_only_adjustment")
  ) {
    const fallback = await admin
      .from("payroll_history")
      .select("payroll_month, net_pay")
      .eq("tenant_id", DAVORS);
    if (fallback.error) throw new Error(fallback.error.message);
    return (fallback.data ?? []).map((row) => ({
      ...row,
      net_only_adjustment: 0,
    }));
  }
  if (preferred.error) throw new Error(preferred.error.message);
  return preferred.data ?? [];
}

async function loadFinanceSnapshot(admin: ReturnType<typeof createClient>) {
  log("loading expense snapshot…");
  const { data: expenseEntries, error: expenseError } = await admin
    .from("expense_register")
    .select(
      "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
    )
    .eq("tenant_id", DAVORS);
  if (expenseError) throw new Error(expenseError.message);

  // Synthetic period net — do not depend on leftover locked payroll_history rows.
  const netByMonth = new Map<string, number>([[TEST_MONTH, NET_PAY]]);
  const wages = [{ payroll_month: TEST_MONTH, net_pay: NET_PAY, net_only_adjustment: 0 }];
  const monthEndCloseRecords = [
    { month: TEST_MONTH, total_net_pay: NET_PAY },
  ];
  const components = buildMonthlyCashComponents(
    {
      incomeEntries: [],
      expenseEntries: expenseEntries ?? [],
      capitalContributions: [],
      fixedAssets: [],
      rawMaterialCashPurchases: [],
      productCashPurchases: [],
      inventoryConfig: null,
      manualEntries: [],
      accountsPayableSettlements: [],
      staffSalaryNetByPayrollMonth: netByMonth,
    },
    FY,
  );
  const accrued = calculateAccruedWagesPayableByMonth(
    wages,
    expenseEntries ?? [],
    FY,
    monthEndCloseRecords,
  );

  return {
    /** March paid-expense outflow (Cash Position uses this for Paid SAL). */
    cashOutflow: r2(components.paidExpenses[TEST_MONTH_NUM - 1] ?? 0),
    accruedWages: r2(accrued[TEST_MONTH_NUM - 1] ?? 0),
    expenses: expenseEntries ?? [],
  };
}

async function loadBsBalance(admin: ReturnType<typeof createClient>) {
  log("loading BS balance check…");
  const [
    { data: incomeEntries },
    { data: expenseEntries },
    { data: fixedAssets },
    { data: payableEntries },
    { data: capitalContributions },
    { data: manualEntries },
    payrollHistory,
    { data: monthEndCloseRecords },
    { data: taxLedgerEntries },
    inventoryBalanceSheet,
  ] = await Promise.all([
    admin
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
      )
      .eq("tenant_id", DAVORS),
    admin
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", DAVORS),
    admin
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .eq("tenant_id", DAVORS),
    admin
      .from("accounts_payable")
      .select(
        "invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category",
      )
      .eq("tenant_id", DAVORS),
    admin
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .eq("tenant_id", DAVORS),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", DAVORS),
    fetchPayrollWages(admin),
    admin
      .from("month_end_close")
      .select("month, total_net_pay")
      .eq("tenant_id", DAVORS),
    admin
      .from("tax_ledger_entries")
      .select(
        "entry_date, period_month, direction, tax_component, tax_amount, status",
      )
      .eq("tenant_id", DAVORS),
    fetchInventoryBalanceSheetInput(admin, DAVORS),
  ]);

  const cashFlow = (expenseEntries ?? []).map((entry) => ({
    date: entry.date,
    expense_category: entry.expense_category,
    sub_category: entry.sub_category,
    amount: Number(entry.amount) || 0,
    payment_status: entry.payment_status,
    description: entry.description ?? null,
    receipt_no: entry.receipt_no ?? null,
    notes: entry.notes ?? null,
  }));

  const report = buildBalanceSheetReport(
    incomeEntries ?? [],
    expenseEntries ?? [],
    fixedAssets ?? [],
    payableEntries ?? [],
    capitalContributions ?? [],
    cashFlow,
    mergePayrollWagesSources(payrollHistory, []),
    monthEndCloseRecords ?? [],
    FY,
    inventoryBalanceSheet,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
  );

  return getBalanceCheckForPeriod(report, TEST_MONTH_NUM - 1);
}

function buildTestRows(): PayrollLockFinanceSourceRow[] {
  return [
    {
      employee_id: TEST_EMPLOYEE,
      gross_pay: GROSS,
      net_only_adjustment: 0,
      absence_deduction: 0,
      loan_repayment: 0,
      salary_advance: 0,
      welfare_deduction: 0,
      other_deductions: 0,
      employee_ssnit: 50,
      employer_ssnit: EMPLOYER_SSNIT,
      tier2: TIER2,
      paye_tax: 20,
    },
  ];
}

async function forceDeleteHistory(admin: ReturnType<typeof createClient>) {
  log("forceDeleteHistory via RPC (best-effort)");
  const { error: rpcError } = await admin.rpc(
    "admin_delete_payroll_history_for_month",
    { p_month: TEST_MONTH, p_tenant_id: DAVORS },
  );
  if (rpcError) {
    log(`RPC history delete skipped: ${rpcError.message}`);
    // Best-effort unlock+delete; ignore failures (leftover locked rows are OK —
    // net_pay for this test comes from month_end_close).
    await admin
      .from("payroll_history")
      .update({ locked: false, locked_at: null })
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", TEST_MONTH);
    await admin
      .from("payroll_history")
      .delete()
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", TEST_MONTH);
  } else {
    log("RPC history delete ok");
  }
}

async function cleanup(admin: ReturnType<typeof createClient>) {
  log("cleanup start");
  const period = resolvePayrollLockFinancePeriod(
    TEST_MONTH,
    TEST_YEAR,
    TEST_MONTH_NUM,
  );
  assert(!!period, "resolve period");

  try {
    await deletePayrollLockFinanceEntries(admin, period!, DAVORS, {
      loanRepaymentRows: [{ employee_id: TEST_EMPLOYEE, loan_repayment: 0 }],
    });
  } catch (error) {
    log(`deletePayrollLockFinanceEntries skipped: ${error}`);
  }

  await admin
    .from("expense_register")
    .delete()
    .eq("tenant_id", DAVORS)
    .ilike("receipt_no", `PAYROLL-%${TEST_PERIOD_KEY}`);
  await admin
    .from("income_register")
    .delete()
    .eq("tenant_id", DAVORS)
    .ilike("invoice_no", `PAYROLL-%${TEST_PERIOD_KEY}`);
  await forceDeleteHistory(admin);
  await admin
    .from("month_end_close")
    .delete()
    .eq("tenant_id", DAVORS)
    .eq("month", TEST_MONTH);
  await admin
    .from("tax_ledger_entries")
    .delete()
    .eq("tenant_id", DAVORS)
    .eq("period_month", TEST_MONTH);
  log("cleanup done");
}

async function seedHistory(admin: ReturnType<typeof createClient>) {
  log("seed month_end_close net (skip payroll_history — locked-row trigger)");
  // Cash + Accrued Wages resolve net from month_end_close when history is absent.
  const { error: closeError } = await admin.from("month_end_close").upsert(
    {
      tenant_id: DAVORS,
      month: TEST_MONTH,
      employees_recorded: 1,
      total_net_pay: NET_PAY,
      lock_status: "Locked",
      notes: "staging lock-paid test",
    },
    { onConflict: "tenant_id,month" },
  );
  if (closeError) throw new Error(`seed month_end_close: ${closeError.message}`);
}

async function fetchExpense(
  admin: ReturnType<typeof createClient>,
  receiptNo: string,
) {
  const { data, error } = await admin
    .from("expense_register")
    .select("id, receipt_no, amount, payment_status, expense_category, notes")
    .eq("tenant_id", DAVORS)
    .eq("receipt_no", receiptNo)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(!!url && !!key, "Missing staging Supabase env");

  const ref = projectRefFromUrl(url);
  assert(!!ref, `Could not parse project ref from ${url}`);
  assert(
    !PRODUCTION_PROJECT_REFS.has(ref!),
    `REFUSING production project ref ${ref}`,
  );
  assert(
    ref === STAGING_PROJECT_REF,
    `Expected staging ref ${STAGING_PROJECT_REF}, got ${ref}`,
  );
  log(`project=${ref}`);

  const admin = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const period = resolvePayrollLockFinancePeriod(
    TEST_MONTH,
    TEST_YEAR,
    TEST_MONTH_NUM,
  );
  assert(!!period, "finance period");

  const results: Result[] = [];
  const rows = buildTestRows();
  const balancedChecks: boolean[] = [];

  // --- a: gate allows mix of full-month + partial days ---
  const gateOk = isFullMonthPayrollLock(
    [
      { employee_id: "e1", days_to_pay: 27 },
      { employee_id: "e2", days_to_pay: 10 },
    ],
    new Set(["e1", "e2"]),
    27,
  );
  const gateMissingStillBlocked = !isFullMonthPayrollLock(
    [{ employee_id: "e1", days_to_pay: 27 }],
    new Set(["e1", "e2"]),
    27,
  );
  results.push({
    name: "a. period with mix of full-month + partial-days can permanent Lock",
    ok: gateOk && gateMissingStillBlocked,
    detail: JSON.stringify({ gateOk, gateMissingStillBlocked }),
  });

  await cleanup(admin);
  await seedHistory(admin);

  const baseline = await loadFinanceSnapshot(admin);
  const bsBaseline = await loadBsBalance(admin);

  // --- c: Partial Lock stays Accrued, no cash ---
  log("partial post");
  await postPayrollLockFinanceEntries(admin, period!, rows, DAVORS, {
    markStaffSalariesPaid: false,
  });
  const salPartial = await fetchExpense(admin, SAL_RECEIPT);
  const essnitPartial = await fetchExpense(admin, ESSNIT_RECEIPT);
  const afterPartial = await loadFinanceSnapshot(admin);
  const bsAfterPartial = await loadBsBalance(admin);
  const cashUnchangedPartial =
    Math.abs(afterPartial.cashOutflow - baseline.cashOutflow) < 0.02;
  const accruedIncreased =
    afterPartial.accruedWages >= r2(baseline.accruedWages + NET_PAY - 0.02);
  results.push({
    name: "c. Partial Lock stays Accrued, no cash",
    ok:
      salPartial?.payment_status === PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED &&
      essnitPartial?.payment_status ===
        PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED &&
      cashUnchangedPartial &&
      accruedIncreased,
    detail: JSON.stringify({
      sal: salPartial?.payment_status,
      essnit: essnitPartial?.payment_status,
      cashOutflowBefore: baseline.cashOutflow,
      cashOutflowAfter: afterPartial.cashOutflow,
      accruedBefore: baseline.accruedWages,
      accruedAfter: afterPartial.accruedWages,
    }),
  });
  balancedChecks.push(
    Math.abs(bsAfterPartial.difference - bsBaseline.difference) < 0.05,
  );

  log("delete after partial");
  await deletePayrollLockFinanceEntries(admin, period!, DAVORS, {
    loanRepaymentRows: rows.map((row) => ({
      employee_id: row.employee_id,
      loan_repayment: row.loan_repayment,
    })),
  });
  await seedHistory(admin);
  const afterPartialDelete = await loadFinanceSnapshot(admin);

  // --- b: permanent Lock → Paid + full cash outflow ---
  log("permanent post");
  const permanentPost = await postPayrollLockFinanceEntries(
    admin,
    period!,
    rows,
    DAVORS,
    { markStaffSalariesPaid: true },
  );
  const salPaid = await fetchExpense(admin, SAL_RECEIPT);
  const essnitPaid = await fetchExpense(admin, ESSNIT_RECEIPT);
  const afterPaid = await loadFinanceSnapshot(admin);
  const cashIncrease = r2(afterPaid.cashOutflow - afterPartialDelete.cashOutflow);
  const cashMatchesNet = Math.abs(cashIncrease - NET_PAY) < 0.02;
  results.push({
    name: "b. permanent Lock → Paid + full cash outflow (SAL only; SSNIT Accrued)",
    ok:
      salPaid?.payment_status === PAYROLL_EXPENSE_PAYMENT_STATUS_PAID &&
      essnitPaid?.payment_status === PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED &&
      cashMatchesNet &&
      afterPaid.accruedWages <= afterPartialDelete.accruedWages + 0.02 &&
      !permanentPost.staffSalariesAlreadyPaid,
    detail: JSON.stringify({
      sal: salPaid?.payment_status,
      essnit: essnitPaid?.payment_status,
      cashOutflowBefore: afterPartialDelete.cashOutflow,
      cashOutflowAfter: afterPaid.cashOutflow,
      cashIncrease,
      expectedNet: NET_PAY,
      accruedBefore: afterPartialDelete.accruedWages,
      accruedAfter: afterPaid.accruedWages,
      staffSalariesAlreadyPaid: permanentPost.staffSalariesAlreadyPaid,
    }),
  });

  // Mid-run BS check after Paid — difference must not widen vs baseline
  // (FY 2099 staging has pre-existing empty-year imbalance; we assert delta≈0).
  const bsAfterPaid = await loadBsBalance(admin);
  balancedChecks.push(
    Math.abs(bsAfterPaid.difference - bsBaseline.difference) < 0.05,
  );

  // --- d: Release reverse ---
  log("release delete");
  const deleted = await deletePayrollLockFinanceEntries(admin, period!, DAVORS, {
    loanRepaymentRows: rows.map((row) => ({
      employee_id: row.employee_id,
      loan_repayment: row.loan_repayment,
    })),
  });
  const salAfterDelete = await fetchExpense(admin, SAL_RECEIPT);
  const afterRelease = await loadFinanceSnapshot(admin);
  const cashRestored =
    Math.abs(afterRelease.cashOutflow - afterPartialDelete.cashOutflow) < 0.02;
  results.push({
    name: "d. Release/Reopen after auto-Paid reverses payment_status + Cash Position",
    ok: !salAfterDelete && deleted.deletedExpenses >= 1 && cashRestored,
    detail: JSON.stringify({
      salAfterDelete,
      deletedExpenses: deleted.deletedExpenses,
      cashOutflowBeforePaid: afterPartialDelete.cashOutflow,
      cashOutflowAfterPaid: afterPaid.cashOutflow,
      cashOutflowAfterRelease: afterRelease.cashOutflow,
    }),
  });

  // --- e: no double-posting if already manually Paid ---
  log("double-post guard setup");
  await seedHistory(admin);
  await postPayrollLockFinanceEntries(admin, period!, rows, DAVORS, {
    markStaffSalariesPaid: false,
  });
  const { error: manualPaidError } = await admin
    .from("expense_register")
    .update({ payment_status: PAYROLL_EXPENSE_PAYMENT_STATUS_PAID })
    .eq("tenant_id", DAVORS)
    .eq("receipt_no", SAL_RECEIPT);
  assert(!manualPaidError, manualPaidError?.message ?? "manual Paid failed");

  const beforeRelock = await loadFinanceSnapshot(admin);
  const relock = await postPayrollLockFinanceEntries(
    admin,
    period!,
    rows,
    DAVORS,
    { markStaffSalariesPaid: true },
  );
  const afterRelock = await loadFinanceSnapshot(admin);
  const salStillPaid = await fetchExpense(admin, SAL_RECEIPT);
  results.push({
    name: "e. no double-posting if already manually Paid",
    ok:
      relock.staffSalariesAlreadyPaid === true &&
      salStillPaid?.payment_status === PAYROLL_EXPENSE_PAYMENT_STATUS_PAID &&
      Math.abs(afterRelock.cashOutflow - beforeRelock.cashOutflow) < 0.02,
    detail: JSON.stringify({
      staffSalariesAlreadyPaid: relock.staffSalariesAlreadyPaid,
      salStatus: salStillPaid?.payment_status,
      cashOutflowBefore: beforeRelock.cashOutflow,
      cashOutflowAfter: afterRelock.cashOutflow,
    }),
  });

  const bsAfterRelock = await loadBsBalance(admin);
  balancedChecks.push(
    Math.abs(bsAfterRelock.difference - bsBaseline.difference) < 0.05,
  );

  results.push({
    name: "f. Balance Sheet stays in balance throughout",
    ok: balancedChecks.every(Boolean),
    detail: JSON.stringify({
      bsBaseline,
      bsAfterPartial,
      bsAfterPaid,
      bsAfterRelock,
      deltas: balancedChecks,
      note: "FY 2099 empty-year has pre-existing imbalance; assert ops do not change difference",
    }),
  });

  await cleanup(admin);

  console.log("\n=== Payroll Lock Paid staging results ===");
  console.log(`Project: ${ref} (staging)`);
  console.log(`Period: ${TEST_MONTH}`);
  let failed = 0;
  for (const result of results) {
    const mark = result.ok ? "PASS" : "FAIL";
    if (!result.ok) failed += 1;
    console.log(`${mark} ${result.name}`);
    console.log(`     ${result.detail}`);
  }
  console.log(
    failed === 0
      ? `\nAll ${results.length} checks passed. Production untouched.`
      : `\n${failed} check(s) failed.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
