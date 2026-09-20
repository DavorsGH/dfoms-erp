/**
 * TASK 1: Backfill July 2026 missing payroll finance postings from payroll_history.
 * TASK 2: Read-only trace of +8.00 GHS non-payroll August BS gap.
 *
 *   npx tsx scripts/fix-july-2026-payroll-finance-backfill-staging.ts
 *   npx tsx scripts/fix-july-2026-payroll-finance-backfill-staging.ts --investigate-only
 *   npx tsx scripts/fix-july-2026-payroll-finance-backfill-staging.ts --execute
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  calculatePayrollLockFinanceTotals,
  postPayrollLockFinanceEntries,
  resolvePayrollLockFinancePeriod,
  type PayrollLockFinanceSourceRow,
} from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";
import { buildPayrollPeriodTaxLedgerSourceId } from "../app/dashboard/hr-payroll/payroll-statutory-ledger-sync";
import type { PayrollHistoryRow } from "../app/dashboard/hr-payroll/payroll-processing-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const JULY_MONTH = "2026-07-01";
const AUG_MONTH = "2026-08-01";
const SEPT_MONTH = "2026-09-01";
const JUL_IDX = 6;
const AUG_IDX = 7;
const SAL_RECEIPT = "PAYROLL-SAL-2026-07";
const ESSNIT_RECEIPT = "PAYROLL-ESSNIT-2026-07";

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

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function log(section: string, detail: unknown) {
  console.log(`\n=== ${section} ===`);
  if (typeof detail === "string") {
    console.log(detail);
  } else {
    console.log(JSON.stringify(detail, null, 2));
  }
}

function historyRowsToFinanceSource(
  rows: PayrollHistoryRow[],
): PayrollLockFinanceSourceRow[] {
  return rows.map((row) => ({
    employee_id: row.employee_id,
    gross_pay: row.gross_pay,
    net_only_adjustment: row.net_only_adjustment,
    absence_deduction: row.absence_deduction,
    loan_repayment: row.loan_repayment,
    salary_advance: row.salary_advance,
    welfare_deduction: row.welfare_deduction,
    other_deductions: row.other_deductions,
    employee_ssnit: row.employee_ssnit,
    employer_ssnit: row.employer_ssnit,
    tier2: row.tier2,
    paye_tax: row.paye_tax,
  }));
}

function monthEnd(fy: number, monthIndex: number) {
  const month = monthIndex + 1;
  const day = new Date(fy, month, 0).getDate();
  return `${fy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function fetchBsDiff(
  admin: ReturnType<typeof createClient>,
  monthIndex: number,
) {
  const data = await fetchBalanceSheetPageData(admin, DAVORS);
  const report = buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    data.initialCashFlowExpenseEntries,
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
    FY,
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    {
      tenantId: DAVORS,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );
  const check = getBalanceCheckForPeriod(report, monthIndex);
  return {
    difference: r2(check.difference),
    isBalanced: check.isBalanced,
    totalAssets: r2(check.totalAssets),
    totalLiabilitiesAndEquity: r2(check.totalLiabilitiesAndEquity),
    report,
  };
}

async function investigateJulyPreflight(admin: ReturnType<typeof createClient>) {
  const payrollSourceId = buildPayrollPeriodTaxLedgerSourceId(JULY_MONTH);
  const [
    { data: historyRows },
    { count: processingCount },
    { data: salExpense },
    { data: essnitExpense },
    { data: taxLegs },
    { data: julyMec },
    { data: augMec },
    { data: septMec },
  ] = await Promise.all([
    admin
      .from("payroll_history")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", JULY_MONTH),
    admin
      .from("payroll_processing")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", JULY_MONTH),
    admin
      .from("expense_register")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("receipt_no", SAL_RECEIPT)
      .maybeSingle(),
    admin
      .from("expense_register")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("receipt_no", ESSNIT_RECEIPT)
      .maybeSingle(),
    admin
      .from("tax_ledger_entries")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("source_id", payrollSourceId)
      .neq("status", "reversed"),
    admin
      .from("month_end_close")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("month", JULY_MONTH)
      .maybeSingle(),
    admin
      .from("month_end_close")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("month", AUG_MONTH)
      .maybeSingle(),
    admin
      .from("month_end_close")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("month", SEPT_MONTH)
      .maybeSingle(),
  ]);

  const rows = (historyRows ?? []) as PayrollHistoryRow[];
  const financeSource = historyRowsToFinanceSource(rows);
  const financePeriod = resolvePayrollLockFinancePeriod(JULY_MONTH, 2026, 7);
  const totals = financePeriod
    ? calculatePayrollLockFinanceTotals(financeSource, financePeriod)
    : null;

  const loanRepaymentTotal = r2(
    rows.reduce((s, r) => s + (Number(r.loan_repayment) || 0), 0),
  );

  return {
    historyCount: rows.length,
    processingCount: processingCount ?? 0,
    grossTotal: r2(rows.reduce((s, r) => s + (Number(r.gross_pay) || 0), 0)),
    netTotal: r2(rows.reduce((s, r) => s + (Number(r.net_pay) || 0), 0)),
    loanRepaymentTotal,
    salExpense,
    essnitExpense,
    taxLegs: taxLegs ?? [],
    payrollSourceId,
    julyMec,
    augMec,
    septMec,
    financePeriod,
    totals,
    financeSource,
    historyRows: rows,
  };
}

async function traceAugustGap(admin: ReturnType<typeof createClient>) {
  const julEnd = monthEnd(FY, JUL_IDX);
  const augEnd = monthEnd(FY, AUG_IDX);
  const augStart = `${FY}-08-01`;

  const julBs = await fetchBsDiff(admin, JUL_IDX);
  const augBs = await fetchBsDiff(admin, AUG_IDX);

  const julRow = julBs.report.rows[JUL_IDX];
  const augRow = augBs.report.rows[AUG_IDX];

  const lineKeys = [
    "cash",
    "accountsReceivable",
    "inventory",
    "fixedAssetsNet",
    "totalAssets",
    "accountsPayable",
    "accruedWagesPayable",
    "netVatPayable",
    "payePayable",
    "ssnitPayable",
    "directorsLoan",
    "capitalContributions",
    "retainedEarnings",
    "totalLiabilitiesAndEquity",
  ];

  const deltas: Record<string, number> = {};
  for (const key of lineKeys) {
    if (julRow[key] !== undefined && augRow[key] !== undefined) {
      deltas[key] = r2((augRow[key] ?? 0) - (julRow[key] ?? 0));
    }
  }

  const assetDelta = r2(
    (deltas.fixedAssetsNet ?? 0) +
      (deltas.cash ?? 0) +
      (deltas.accountsReceivable ?? 0) +
      (deltas.inventory ?? 0),
  );
  const leDelta = r2(
    (deltas.accountsPayable ?? 0) +
      (deltas.accruedWagesPayable ?? 0) +
      (deltas.netVatPayable ?? 0) +
      (deltas.payePayable ?? 0) +
      (deltas.ssnitPayable ?? 0) +
      (deltas.directorsLoan ?? 0) +
      (deltas.capitalContributions ?? 0) +
      (deltas.retainedEarnings ?? 0),
  );

  const [
    { data: augExpenses },
    { data: augIncome },
    { data: augManual },
    { data: augTax },
    { data: augCapContrib },
    { data: augApPayments },
    { data: augDirLoanRepay },
    { data: augFixedAssets },
    { data: julFixedAssets },
  ] = await Promise.all([
    admin
      .from("expense_register")
      .select("*")
      .eq("tenant_id", DAVORS)
      .gte("date", augStart)
      .lte("date", augEnd)
      .order("date"),
    admin
      .from("income_register")
      .select("*")
      .eq("tenant_id", DAVORS)
      .gte("date", augStart)
      .lte("date", augEnd)
      .order("date"),
    admin
      .from("manual_financial_entries")
      .select("*")
      .eq("tenant_id", DAVORS)
      .gte("entry_date", augStart)
      .lte("entry_date", augEnd)
      .order("entry_date"),
    admin
      .from("tax_ledger_entries")
      .select("*")
      .eq("tenant_id", DAVORS)
      .gte("entry_date", augStart)
      .lte("entry_date", augEnd)
      .neq("status", "reversed")
      .order("entry_date"),
    admin
      .from("capital_contributions")
      .select("*")
      .eq("tenant_id", DAVORS)
      .gte("date", augStart)
      .lte("date", augEnd)
      .order("date"),
    admin
      .from("accounts_payable_payments")
      .select("*")
      .eq("tenant_id", DAVORS)
      .gte("payment_date", augStart)
      .lte("payment_date", augEnd)
      .order("payment_date"),
    admin
      .from("directors_loan_repayments")
      .select("*")
      .eq("tenant_id", DAVORS)
      .gte("repayment_date", augStart)
      .lte("repayment_date", augEnd)
      .order("repayment_date"),
    admin
      .from("fixed_assets")
      .select("*")
      .eq("tenant_id", DAVORS)
      .order("purchase_date"),
    admin
      .from("fixed_assets")
      .select("*")
      .eq("tenant_id", DAVORS)
      .order("purchase_date"),
  ]);

  const nonPayrollAugExpenses = (augExpenses ?? []).filter(
    (e) => !String(e.receipt_no ?? "").startsWith("PAYROLL-"),
  );
  const nonPayrollAugTax = (augTax ?? []).filter(
    (t) => !String(t.source_id ?? "").startsWith("a11ce000-0000-5000-8000-0000202608"),
  );

  const cashImpactExpenses = nonPayrollAugExpenses.filter(
    (e) => e.payment_status === "Paid" || e.payment_status === "Partially Paid",
  );

  const manualDirectorsLoan = (augManual ?? []).filter((m) =>
    String(m.account_name ?? m.description ?? "")
      .toLowerCase()
      .includes("director"),
  );

  const apDirectorsLoan = (augApPayments ?? []).filter(
    (p) => p.payment_source === "directors_loan",
  );

  return {
    julBs: {
      difference: julBs.difference,
      isBalanced: julBs.isBalanced,
      totalAssets: julBs.totalAssets,
      totalLiabilitiesAndEquity: julBs.totalLiabilitiesAndEquity,
    },
    augBs: {
      difference: augBs.difference,
      isBalanced: augBs.isBalanced,
      totalAssets: augBs.totalAssets,
      totalLiabilitiesAndEquity: augBs.totalLiabilitiesAndEquity,
    },
    julRow: Object.fromEntries(lineKeys.map((k) => [k, julRow[k]])),
    augRow: Object.fromEntries(lineKeys.map((k) => [k, augRow[k]])),
    deltas,
    assetDeltaFromComponents: assetDelta,
    leDeltaFromComponents: leDelta,
    componentImbalance: r2(assetDelta - leDelta),
    augustActivity: {
      nonPayrollExpenseCount: nonPayrollAugExpenses.length,
      nonPayrollExpenses: nonPayrollAugExpenses.map((e) => ({
        date: e.date,
        receipt_no: e.receipt_no,
        category: e.expense_category,
        amount: r2(e.amount),
        payment_status: e.payment_status,
        description: e.description?.slice(0, 80),
      })),
      cashImpactExpenses: cashImpactExpenses.map((e) => ({
        date: e.date,
        receipt_no: e.receipt_no,
        amount: r2(e.amount),
        payment_status: e.payment_status,
        category: e.expense_category,
      })),
      income: (augIncome ?? []).map((i) => ({
        date: i.date,
        receipt_no: i.receipt_no,
        amount: r2(i.amount),
        payment_status: i.payment_status,
        category: i.income_category,
      })),
      manualEntries: (augManual ?? []).map((m) => ({
        entry_date: m.entry_date,
        account_name: m.account_name,
        debit: r2(m.debit),
        credit: r2(m.credit),
        description: m.description?.slice(0, 80),
      })),
      manualDirectorsLoan,
      nonPayrollTax: nonPayrollAugTax.map((t) => ({
        entry_date: t.entry_date,
        tax_component: t.tax_component,
        tax_amount: r2(t.tax_amount),
        source_type: t.source_type,
        source_id: t.source_id,
      })),
      capitalContributions: augCapContrib ?? [],
      apDirectorsLoanPayments: apDirectorsLoan.map((p) => ({
        payment_date: p.payment_date,
        amount: r2(p.amount),
        payment_source: p.payment_source,
        notes: p.notes,
      })),
      directorsLoanRepayments: (augDirLoanRepay ?? []).map((r) => ({
        repayment_date: r.repayment_date,
        amount: r2(r.amount),
        notes: r.notes,
      })),
    },
  };
}

async function main() {
  const mode = process.argv.includes("--execute")
    ? "execute"
    : process.argv.includes("--investigate-only")
      ? "investigate-only"
      : "plan-and-execute";

  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Refusing non-staging URL: ${url}`);
  assert(!!key, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  log("TASK 1 — JULY PRE-FLIGHT", "Investigating July payroll/finance state…");
  const preflight = await investigateJulyPreflight(admin);

  log("July state", {
    historyCount: preflight.historyCount,
    processingCount: preflight.processingCount,
    grossTotal: preflight.grossTotal,
    netTotal: preflight.netTotal,
    loanRepaymentTotal: preflight.loanRepaymentTotal,
    salExpenseExists: !!preflight.salExpense,
    essnitExpenseExists: !!preflight.essnitExpense,
    taxLegCount: preflight.taxLegs.length,
    payrollSourceId: preflight.payrollSourceId,
    julyMec: preflight.julyMec,
    expectedTotals: preflight.totals,
  });

  assert(preflight.historyCount === 21, `Expected 21 history rows, got ${preflight.historyCount}`);
  assert(
    preflight.processingCount === 0,
    `Expected 0 processing rows, got ${preflight.processingCount}`,
  );
  assert(!preflight.salExpense, "PAYROLL-SAL-2026-07 already exists — abort");
  assert(!preflight.essnitExpense, "PAYROLL-ESSNIT-2026-07 already exists — abort");
  assert(preflight.taxLegs.length === 0, "July tax legs already exist — abort");
  assert(
    preflight.julyMec?.lock_status === "Partially Locked",
    `July MEC expected Partially Locked, got ${preflight.julyMec?.lock_status}`,
  );

  const plan = {
    action: "Backfill finance only — do NOT touch payroll_history, payroll_processing, or month_end_close",
    writers: [
      "postPayrollLockFinanceEntries(historyRowsToFinanceSource, markStaffSalariesPaid: false)",
      "syncPayrollPeriodTaxLedger (called inside postPayrollLockFinanceEntries)",
    ],
    skipLoanRepayments: false,
    skipLoanRepaymentsReason:
      "Finance never ran on original partial lock; loan_register was not updated via lock path",
    expectedPostings: {
      staffSalaries: preflight.totals?.totalStaffSalariesExpense,
      employerSsnit: preflight.totals?.totalEmployerSsnitContribution,
      paye: preflight.totals?.totalPayeTax,
      ssnitRemittance: preflight.totals?.totalSsnitRemittance,
      deductionSavingsIncome: preflight.totals?.totalDeductionSavings,
    },
    verification: [
      "July BS diff = 0.00",
      "August BS diff unchanged at +8.00",
      "September MEC unchanged",
    ],
  };
  log("TASK 1 — EXECUTION PLAN", plan);

  const julBsBefore = await fetchBsDiff(admin, JUL_IDX);
  const augBsBefore = await fetchBsDiff(admin, AUG_IDX);
  log("BS before backfill", {
    july: julBsBefore.difference,
    julyNote:
      julBsBefore.difference === 0
        ? "Currently 0.00 but ACCIDENTALLY balanced (payroll invisible)"
        : "Not balanced",
    august: augBsBefore.difference,
  });

  if (mode === "investigate-only") {
    log("MODE", "investigate-only — skipping July backfill execution");
  } else {
    log("TASK 1 — EXECUTING BACKFILL", "Calling postPayrollLockFinanceEntries…");
    const financePeriod = preflight.financePeriod;
    assert(!!financePeriod, "Missing finance period");

    const result = await postPayrollLockFinanceEntries(
      admin,
      financePeriod,
      preflight.financeSource,
      DAVORS,
      {
        markStaffSalariesPaid: false,
        skipLoanRepayments: false,
        businessUnitId: null,
      },
    );

    log("Backfill result", result);

    const afterPreflight = await investigateJulyPreflight(admin);
    log("July finance after backfill", {
      salAmount: afterPreflight.salExpense
        ? r2(Number(afterPreflight.salExpense.amount))
        : null,
      salStatus: afterPreflight.salExpense?.payment_status,
      essnitAmount: afterPreflight.essnitExpense
        ? r2(Number(afterPreflight.essnitExpense.amount))
        : null,
      taxLegs: afterPreflight.taxLegs.map((t) => ({
        component: t.tax_component,
        amount: r2(t.tax_amount),
      })),
      historyCount: afterPreflight.historyCount,
      processingCount: afterPreflight.processingCount,
      julyMec: afterPreflight.julyMec,
      augMec: afterPreflight.augMec,
      septMec: afterPreflight.septMec,
    });

    const julBsAfter = await fetchBsDiff(admin, JUL_IDX);
    const augBsAfter = await fetchBsDiff(admin, AUG_IDX);
    log("BS after backfill", {
      july: julBsAfter,
      august: augBsAfter,
      augustUnchanged: augBsAfter.difference === augBsBefore.difference,
    });

    assert(
      julBsAfter.isBalanced && julBsAfter.difference === 0,
      `July BS not balanced after backfill: diff=${julBsAfter.difference}`,
    );
    assert(
      augBsAfter.difference === augBsBefore.difference,
      `August BS changed: before=${augBsBefore.difference} after=${augBsAfter.difference}`,
    );
    assert(
      JSON.stringify(afterPreflight.augMec) === JSON.stringify(preflight.augMec),
      "August MEC changed",
    );
    assert(
      JSON.stringify(afterPreflight.septMec) === JSON.stringify(preflight.septMec),
      "September MEC changed",
    );
  }

  log("TASK 2 — AUGUST +8.00 GAP TRACE (read-only)", "Tracing Jul→Aug deltas…");
  const gapTrace = await traceAugustGap(admin);
  log("Balance sheet comparison", {
    july: gapTrace.julBs,
    august: gapTrace.augBs,
    deltas: gapTrace.deltas,
    assetDeltaFromComponents: gapTrace.assetDeltaFromComponents,
    leDeltaFromComponents: gapTrace.leDeltaFromComponents,
    componentImbalance: gapTrace.componentImbalance,
  });
  log("August non-payroll activity", gapTrace.augustActivity);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
