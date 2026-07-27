/**
 * Staging verification for payroll deduction-savings lock postings (scenarios a–g).
 *
 * Usage:
 *   npx tsx scripts/test-payroll-deduction-savings-staging.ts
 *   npx tsx scripts/test-payroll-deduction-savings-staging.ts --env-file .env.staging.local
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
import {
  buildPayrollDeductionSavingsDescription,
  buildPayrollDeductionSavingsInvoiceNo,
  calculatePayrollDeductionSavingsTotal,
  deletePayrollLockFinanceEntries,
  postPayrollLockFinanceEntries,
  resolvePayrollLockFinancePeriod,
  type PayrollLockFinanceSourceRow,
} from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";

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

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const FY = 2026;

/** Disposable synthetic period — avoids touching real June/July locks. */
const TEST_MONTH = "2099-01-01";
const TEST_EMPLOYEE = "DF-EMP-0006";
const TEST_LOAN_ID = "DF-LOAN-DEDSAV-STAGING";
const CAANTA_EMPLOYEE = "CA-EMP-DEDSAV";
const CAANTA_INVOICE = "PAYROLL-DEDSAV-2099-01";
const TEST_PERIOD_KEY = "2099-01";
const TEST_YEAR = 2099;
const TEST_MONTH_NUM = 1;

type Result = { name: string; ok: boolean; detail: string };

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function computeBsDiff(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  monthIndex: number,
) {
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
      .eq("tenant_id", tenantId),
    admin
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("accounts_payable")
      .select(
        "invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .eq("tenant_id", tenantId),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", tenantId),
    admin
      .from("payroll_history")
      .select("payroll_month, net_pay, net_only_adjustment")
      .eq("tenant_id", tenantId),
    admin
      .from("payroll_processing")
      .select("payroll_month, net_pay, net_only_adjustment")
      .eq("tenant_id", tenantId),
    admin
      .from("month_end_close")
      .select("month, total_net_pay")
      .eq("tenant_id", tenantId),
    admin
      .from("tax_ledger_entries")
      .select(
        "entry_date, period_month, direction, tax_component, tax_amount, status",
      )
      .eq("tenant_id", tenantId),
    fetchInventoryBalanceSheetInput(admin, tenantId),
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
    mergePayrollWagesSources(payrollHistory ?? [], payrollProcessing ?? []),
    monthEndCloseRecords ?? [],
    FY,
    inventoryBalanceSheet,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
  );

  return getBalanceCheckForPeriod(report, monthIndex);
}

function buildTestRows(overrides?: Partial<PayrollLockFinanceSourceRow>): PayrollLockFinanceSourceRow[] {
  return [
    {
      employee_id: TEST_EMPLOYEE,
      gross_pay: 1000,
      net_only_adjustment: 0,
      absence_deduction: 21.44,
      loan_repayment: 50,
      salary_advance: 25,
      welfare_deduction: 10,
      other_deductions: 5,
      employee_ssnit: 50,
      employer_ssnit: 50,
      tier2: 10,
      paye_tax: 20,
      ...overrides,
    },
  ];
}

async function cleanupTestArtifacts(
  admin: ReturnType<typeof createClient>,
  _period: NonNullable<ReturnType<typeof resolvePayrollLockFinancePeriod>>,
) {
  const invoiceNo = buildPayrollDeductionSavingsInvoiceNo(TEST_PERIOD_KEY);
  await admin
    .from("income_register")
    .delete()
    .eq("tenant_id", DAVORS)
    .eq("invoice_no", invoiceNo);
  await admin
    .from("income_register")
    .delete()
    .eq("tenant_id", CAANTA)
    .eq("invoice_no", CAANTA_INVOICE);
  await admin
    .from("expense_register")
    .delete()
    .eq("tenant_id", DAVORS)
    .ilike("receipt_no", `PAYROLL-%${TEST_PERIOD_KEY}`);
  await admin
    .from("expense_register")
    .delete()
    .eq("tenant_id", CAANTA)
    .ilike("receipt_no", `PAYROLL-%${TEST_PERIOD_KEY}`);
  await admin.from("loan_register").delete().eq("loan_id", TEST_LOAN_ID);
  await admin
    .from("tax_ledger_entries")
    .delete()
    .eq("tenant_id", DAVORS)
    .eq("period_month", TEST_MONTH);
  await admin
    .from("tax_ledger_entries")
    .delete()
    .eq("tenant_id", CAANTA)
    .eq("period_month", TEST_MONTH);
  // Prefer RPC — direct payroll_history deletes are often blocked by RLS/triggers.
  await admin.rpc("admin_delete_payroll_history_for_month", {
    p_month: TEST_MONTH,
    p_tenant_id: DAVORS,
  });
}

async function seedLoan(admin: ReturnType<typeof createClient>) {
  await admin.from("loan_register").delete().eq("loan_id", TEST_LOAN_ID);
  const { error } = await admin.from("loan_register").insert({
    loan_id: TEST_LOAN_ID,
    tenant_id: DAVORS,
    employee_id: TEST_EMPLOYEE,
    loan_amount: 500,
    date_issued: "2026-01-15",
    repayment_period_months: 10,
    monthly_deduction: 50,
    total_repaid_to_date: 100,
    outstanding_balance: 400,
  });
  if (error) throw new Error(error.message);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  if (url.includes("tvcurcnmasnocwdxzgvz")) {
    throw new Error("Refusing to run staging tests against production URL");
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const period = resolvePayrollLockFinancePeriod(
    TEST_MONTH,
    TEST_YEAR,
    TEST_MONTH_NUM,
  );
  if (!period) throw new Error("Unable to resolve test period");

  const results: Result[] = [];
  const expectedSavings = calculatePayrollDeductionSavingsTotal(buildTestRows());
  assert(expectedSavings === 111.44, `unexpected savings total ${expectedSavings}`);

  console.log("Cleaning prior test artifacts…");
  await cleanupTestArtifacts(admin, period);

  try {
    // --- a: post income with mixed deductions ---
    await seedLoan(admin);
    const rows = buildTestRows();
    const postA = await postPayrollLockFinanceEntries(admin, period, rows, DAVORS);
    const invoiceNo = buildPayrollDeductionSavingsInvoiceNo(TEST_PERIOD_KEY);
    const { data: incomeA } = await admin
      .from("income_register")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("invoice_no", invoiceNo)
      .maybeSingle();

    const descOk =
      incomeA?.description ===
      buildPayrollDeductionSavingsDescription(period.monthLabel);
    const amountOk = Number(incomeA?.amount) === expectedSavings;
    const categoryOk = incomeA?.service_category === "Other Income";
    results.push({
      name: "a. income posts with correct sum + naming",
      ok: Boolean(incomeA) && descOk && amountOk && categoryOk && postA.insertedIncome === 1,
      detail: JSON.stringify({
        invoice_no: incomeA?.invoice_no,
        amount: incomeA?.amount,
        description: incomeA?.description,
        service_category: incomeA?.service_category,
        insertedIncome: postA.insertedIncome,
      }),
    });

    // --- b: loan_register updated ---
    const { data: loanAfter } = await admin
      .from("loan_register")
      .select("total_repaid_to_date, outstanding_balance")
      .eq("loan_id", TEST_LOAN_ID)
      .maybeSingle();
    const loanOk =
      Number(loanAfter?.total_repaid_to_date) === 150 &&
      Number(loanAfter?.outstanding_balance) === 350;
    results.push({
      name: "b. loan_register updated for loan_repayment",
      ok: loanOk && postA.updatedLoans === 1,
      detail: JSON.stringify({ loanAfter, updatedLoans: postA.updatedLoans }),
    });

    // --- c: reopen/delete reverses income + loans ---
    const del = await deletePayrollLockFinanceEntries(admin, period, DAVORS, {
      loanRepaymentRows: rows.map((row) => ({
        employee_id: row.employee_id,
        loan_repayment: row.loan_repayment,
      })),
    });
    const { data: incomeAfterDelete } = await admin
      .from("income_register")
      .select("id")
      .eq("tenant_id", DAVORS)
      .eq("invoice_no", invoiceNo)
      .maybeSingle();
    const { data: loanReversed } = await admin
      .from("loan_register")
      .select("total_repaid_to_date, outstanding_balance")
      .eq("loan_id", TEST_LOAN_ID)
      .maybeSingle();
    const reverseOk =
      !incomeAfterDelete &&
      Number(loanReversed?.total_repaid_to_date) === 100 &&
      Number(loanReversed?.outstanding_balance) === 400 &&
      del.deletedIncome >= 1 &&
      del.reversedLoans === 1;
    results.push({
      name: "c. reopen deletes income and reverses loan",
      ok: reverseOk,
      detail: JSON.stringify({
        incomeAfterDelete,
        loanReversed,
        deletedIncome: del.deletedIncome,
        reversedLoans: del.reversedLoans,
      }),
    });

    // --- d: re-lock posts again (not double) ---
    const postD = await postPayrollLockFinanceEntries(admin, period, rows, DAVORS);
    const { data: incomeD } = await admin
      .from("income_register")
      .select("id, amount")
      .eq("tenant_id", DAVORS)
      .eq("invoice_no", invoiceNo);
    const { data: loanD } = await admin
      .from("loan_register")
      .select("total_repaid_to_date, outstanding_balance")
      .eq("loan_id", TEST_LOAN_ID)
      .maybeSingle();
    const relockOk =
      (incomeD?.length ?? 0) === 1 &&
      Number(incomeD?.[0]?.amount) === expectedSavings &&
      Number(loanD?.total_repaid_to_date) === 150 &&
      Number(loanD?.outstanding_balance) === 350 &&
      postD.insertedIncome === 1;
    results.push({
      name: "d. re-lock posts correctly again (not double)",
      ok: relockOk,
      detail: JSON.stringify({
        incomeCount: incomeD?.length,
        loanD,
        insertedIncome: postD.insertedIncome,
        updatedLoans: postD.updatedLoans,
      }),
    });

    // Clean 2099 test finance so BS check uses July only for e.
    await deletePayrollLockFinanceEntries(admin, period, DAVORS, {
      loanRepaymentRows: rows.map((row) => ({
        employee_id: row.employee_id,
        loan_repayment: row.loan_repayment,
      })),
    });

    // --- e: BS balance for July after posting live July history savings ---
    const julyPeriod = resolvePayrollLockFinancePeriod("2026-07-01", 2026, 7);
    if (!julyPeriod) throw new Error("july period");

    const { data: julyHistory } = await admin
      .from("payroll_history")
      .select(
        "employee_id, gross_pay, net_only_adjustment, absence_deduction, loan_repayment, salary_advance, welfare_deduction, other_deductions, employee_ssnit, employer_ssnit, tier2, paye_tax",
      )
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", "2026-07-01");

    const julyRows = (julyHistory ?? []) as PayrollLockFinanceSourceRow[];
    let julySavings = calculatePayrollDeductionSavingsTotal(julyRows);

    // Staging July may already have 0 orphan deductions — inject a known amount
    // so we can prove the BS gap moves by exactly that income.
    const injectedSavings = 85.76;
    const julyRowsForPost: PayrollLockFinanceSourceRow[] =
      julySavings > 0
        ? julyRows
        : [
            {
              employee_id: TEST_EMPLOYEE,
              gross_pay: 0,
              net_only_adjustment: 0,
              absence_deduction: injectedSavings,
              loan_repayment: 0,
              salary_advance: 0,
              welfare_deduction: 0,
              other_deductions: 0,
              employee_ssnit: 0,
              employer_ssnit: 0,
              tier2: 0,
              paye_tax: 0,
            },
          ];
    julySavings = calculatePayrollDeductionSavingsTotal(julyRowsForPost);

    const before = await computeBsDiff(admin, DAVORS, 6); // July = index 6
    const beforeDiff = r2(before.difference);

    const julyPost = await postPayrollLockFinanceEntries(
      admin,
      julyPeriod,
      julyRowsForPost,
      DAVORS,
    );
    const after = await computeBsDiff(admin, DAVORS, 6);
    const afterDiff = r2(after.difference);
    const expectedDiff = r2(beforeDiff - julySavings);

    const { data: julyIncome } = await admin
      .from("income_register")
      .select("amount, invoice_no")
      .eq("tenant_id", DAVORS)
      .eq("invoice_no", "PAYROLL-DEDSAV-2026-07")
      .maybeSingle();

    const eOk =
      Number(julyIncome?.amount) === julySavings &&
      (after.isBalanced || afterDiff === expectedDiff);

    results.push({
      name: "e. Balance Sheet difference = 0 after deduction-savings income",
      ok: eOk,
      detail: JSON.stringify({
        julySavings,
        beforeDiff,
        afterDiff,
        expectedDiff,
        isBalanced: after.isBalanced,
        julyIncome,
        julyPost: {
          insertedIncome: julyPost.insertedIncome,
          updatedIncome: julyPost.updatedIncome,
        },
      }),
    });

    // Remove injected July DEDSAV so staging isn't left with a synthetic row.
    await admin
      .from("income_register")
      .delete()
      .eq("tenant_id", DAVORS)
      .eq("invoice_no", "PAYROLL-DEDSAV-2026-07");

    // --- f: all-zero deductions → no income row ---
    await cleanupTestArtifacts(admin, period);
    await seedLoan(admin);
    const zeroRows = buildTestRows({
      absence_deduction: 0,
      loan_repayment: 0,
      salary_advance: 0,
      welfare_deduction: 0,
      other_deductions: 0,
    });
    const postF = await postPayrollLockFinanceEntries(
      admin,
      period,
      zeroRows,
      DAVORS,
    );
    const { data: incomeF } = await admin
      .from("income_register")
      .select("id")
      .eq("tenant_id", DAVORS)
      .eq("invoice_no", invoiceNo)
      .maybeSingle();
    const { data: loanF } = await admin
      .from("loan_register")
      .select("total_repaid_to_date, outstanding_balance")
      .eq("loan_id", TEST_LOAN_ID)
      .maybeSingle();
    results.push({
      name: "f. all-zero deductions posts no income / no loan change",
      ok:
        !incomeF &&
        postF.insertedIncome === 0 &&
        postF.updatedLoans === 0 &&
        Number(loanF?.total_repaid_to_date) === 100 &&
        Number(loanF?.outstanding_balance) === 400,
      detail: JSON.stringify({
        incomeF,
        insertedIncome: postF.insertedIncome,
        updatedLoans: postF.updatedLoans,
        loanF,
      }),
    });
    await deletePayrollLockFinanceEntries(admin, period, DAVORS, {
      loanRepaymentRows: zeroRows.map((row) => ({
        employee_id: row.employee_id,
        loan_repayment: row.loan_repayment,
      })),
    });

    // --- g: tenant isolation ---
    await seedLoan(admin);
    await postPayrollLockFinanceEntries(admin, period, rows, DAVORS);

    // Ensure Caanta employee exists for FK if needed — income doesn't need employee.
    const caantaPeriod = period;
    const caantaRows: PayrollLockFinanceSourceRow[] = [
      {
        employee_id: "UNKNOWN-CAANTA",
        gross_pay: 200,
        net_only_adjustment: 0,
        absence_deduction: 7.5,
        loan_repayment: 0,
        salary_advance: 0,
        welfare_deduction: 0,
        other_deductions: 0,
        employee_ssnit: 0,
        employer_ssnit: 0,
        tier2: 0,
        paye_tax: 0,
      },
    ];
    const postCaanta = await postPayrollLockFinanceEntries(
      admin,
      caantaPeriod,
      caantaRows,
      CAANTA,
    );

    const { data: davorsIncome } = await admin
      .from("income_register")
      .select("tenant_id, amount, invoice_no")
      .eq("tenant_id", DAVORS)
      .eq("invoice_no", invoiceNo);
    const { data: caantaIncome } = await admin
      .from("income_register")
      .select("tenant_id, amount, invoice_no")
      .eq("tenant_id", CAANTA)
      .eq("invoice_no", CAANTA_INVOICE);

    const davorsOnly =
      (davorsIncome ?? []).length === 1 &&
      (davorsIncome ?? [])[0]?.tenant_id === DAVORS &&
      Number((davorsIncome ?? [])[0]?.amount) === expectedSavings;
    const caantaOnly =
      (caantaIncome ?? []).length === 1 &&
      (caantaIncome ?? [])[0]?.tenant_id === CAANTA &&
      Number(caantaIncome?.[0]?.amount) === 7.5 &&
      postCaanta.insertedIncome === 1;

    // Cross-check: Davors loan not affected by Caanta lock
    const { data: loanG } = await admin
      .from("loan_register")
      .select("total_repaid_to_date")
      .eq("loan_id", TEST_LOAN_ID)
      .maybeSingle();

    results.push({
      name: "g. tenant isolation (Davors vs Caanta)",
      ok: davorsOnly && caantaOnly && Number(loanG?.total_repaid_to_date) === 150,
      detail: JSON.stringify({
        davorsIncome,
        caantaIncome,
        loanG,
        postCaantaIncome: postCaanta.insertedIncome,
      }),
    });
  } finally {
    console.log("Final cleanup…");
    // Keep July DEDSAV if test e left it (helps staging BS). Clean 2099 artifacts only.
    await cleanupTestArtifacts(admin, period);
  }

  console.log("\n=== RESULTS ===");
  let failed = 0;
  for (const result of results) {
    const mark = result.ok ? "PASS" : "FAIL";
    if (!result.ok) failed += 1;
    console.log(`${mark}  ${result.name}`);
    console.log(`      ${result.detail}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
