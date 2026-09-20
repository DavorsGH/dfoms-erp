/**
 * Read-only: diagnose +8 GHS BS gap — July vs August accrued wages & line deltas.
 *   npx tsx scripts/probe-august-bs-gap-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildNetPayByPayrollMonth,
  calculateAccruedWagesPayableByMonth,
  isAccruedStaffSalariesExpense,
  isStaffSalariesExpenseEntry,
  mergePayrollWagesSources,
  resolveNetPayForPayrollMonth,
  resolveStaffSalariesPayrollMonth,
  sumNetPayByPayrollMonth,
} from "../app/dashboard/finance/accrued-wages-utils";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";
import { buildPayrollPeriodTaxLedgerSourceId } from "../app/dashboard/hr-payroll/payroll-statutory-ledger-sync";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const JUL_IDX = 6;
const AUG_IDX = 7;

function loadEnv(f) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function explainAccruedWagesForMonth(
  payrollHistory,
  expenses,
  monthEndClose,
  financialYear,
  targetMonthIndex,
) {
  const month = targetMonthIndex + 1;
  const monthEnd = `${financialYear}-${String(month).padStart(2, "0")}-${new Date(financialYear, month, 0).getDate()}`;
  const netPayByMonth = buildNetPayByPayrollMonth(payrollHistory, monthEndClose);
  const lineItems = [];

  for (const expense of expenses) {
    if (!isStaffSalariesExpenseEntry(expense)) continue;
    const payrollMonth = resolveStaffSalariesPayrollMonth(expense);
    const expenseDate = expense.date?.slice(0, 10);
    if (!expenseDate || expenseDate > monthEnd) continue;

    const monthNet = r2(
      netPayByMonth.get(payrollMonth) ??
        resolveNetPayForPayrollMonth(payrollMonth, payrollHistory, monthEndClose),
    );
    const accrued = isAccruedStaffSalariesExpense(expense);
    lineItems.push({
      payrollMonth,
      receipt_no: expense.receipt_no,
      expenseAmount: r2(expense.amount),
      payment_status: expense.payment_status,
      expenseDate,
      historyNetPay: monthNet,
      countsAsAccruedWages: accrued,
      accruedContribution: accrued ? monthNet : 0,
    });
  }

  const total = calculateAccruedWagesPayableByMonth(
    payrollHistory,
    expenses,
    financialYear,
    monthEndClose,
  )[targetMonthIndex];

  return { monthEnd, accruedWagesPayable: r2(total), lineItems };
}

function buildReport(data, payrollHistory, expenses, taxEntries) {
  const cashFlowExpenseEntries = expenses.map((entry) => ({
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
    expenses,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    cashFlowExpenseEntries,
    payrollHistory,
    data.initialMonthEndCloseNetPay,
    FY,
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    taxEntries,
    {
      tenantId: DAVORS,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING_REF)) throw new Error("Not staging");
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const data = await fetchBalanceSheetPageData(admin, DAVORS);
  const liveBundle = await fetchPayrollLiveRecalcBundle(admin, { tenantId: DAVORS });
  const payrollHistory = mergePayrollWagesWithLiveOpenMonths(
    data.initialPayrollHistory,
    data.initialPayrollProcessingRows,
    liveBundle.employees,
    liveBundle.liveContext,
  );
  const expenses = data.initialExpenseEntries;
  const mec = data.initialMonthEndCloseNetPay;
  const augTaxSrc = buildPayrollPeriodTaxLedgerSourceId("2026-08-01");

  console.log("=== 1. Accrued Wages Payable logic (July vs August) ===\n");

  for (const [label, idx] of [
    ["July", JUL_IDX],
    ["August", AUG_IDX],
  ]) {
    const expl = explainAccruedWagesForMonth(payrollHistory, expenses, mec, FY, idx);
    console.log(`${label} (month-end ${expl.monthEnd}):`);
    console.log(`  Accrued Wages Payable: GHS ${expl.accruedWagesPayable}`);
    if (expl.lineItems.length === 0) {
      console.log(
        "  → No qualifying PAYROLL-SAL row with expense.date ≤ month-end; payroll_history net is NOT used.",
      );
    } else {
      for (const li of expl.lineItems) {
        console.log(
          `  → ${li.receipt_no}: expense gross=${li.expenseAmount}, history net=${li.historyNetPay}, accrued=${li.countsAsAccruedWages} → liability +${li.accruedContribution}`,
        );
      }
    }
    console.log();
  }

  const julyHistRows = (data.initialPayrollHistory ?? []).filter(
    (e) => String(e.payroll_month).slice(0, 7) === "2026-07",
  );
  const julyGross = r2(julyHistRows.reduce((s, e) => s + (Number(e.gross_pay) || 0), 0));
  const julyNet = r2(julyHistRows.reduce((s, e) => s + (Number(e.net_pay) || 0), 0));
  const julyErSsnit = r2(
    julyHistRows.reduce((s, e) => s + (Number(e.employer_ssnit) || 0) + (Number(e.tier2) || 0), 0),
  );

  console.log("=== 2. Is July genuinely balanced or accidentally so? ===\n");
  console.log({
    julyHistoryRows: julyHistRows.length,
    julyGrossPay: julyGross,
    julyNetPay: julyNet,
    julyPayrollSalExpense: "NONE",
    julyPayrollEssnitExpense: "NONE",
    julyTaxLedgerLegs: "NONE",
    julyAccruedWages: explainAccruedWagesForMonth(payrollHistory, expenses, mec, FY, JUL_IDX)
      .accruedWagesPayable,
    verdict:
      "July payroll is invisible to BS (no P&L expense, no accrued wages liability, no tax liabilities). RE is overstated by ~julyGross+julyErSsnit vs a properly locked month, but nothing on BS references it — accidental zero, not accurate payroll accounting.",
  });

  const report = buildReport(data, payrollHistory, expenses, data.initialTaxLedgerEntries);
  const julCheck = getBalanceCheckForPeriod(report, JUL_IDX);
  const augCheck = getBalanceCheckForPeriod(report, AUG_IDX);

  const expensesNoAug = expenses.filter(
    (e) => e.receipt_no !== "PAYROLL-SAL-2026-08" && e.receipt_no !== "PAYROLL-ESSNIT-2026-08",
  );
  const taxNoAug = (data.initialTaxLedgerEntries ?? []).filter((t) => {
    return !(
      String(t.period_month ?? "").startsWith("2026-08") &&
      t.direction === "statutory_payable" &&
      ["paye", "ssnit_employee", "ssnit_employer_tier1", "ssnit_tier2"].includes(t.tax_component)
    );
  });
  const reportNoAugPayroll = buildReport(data, payrollHistory, expensesNoAug, taxNoAug);

  console.log("\n=== 3b. Accrued Wages with vs without August SAL expense ===");
  const accruedWith = r2(
    report.rows.find((r) => r.key === "accrued-wages-payable")?.amounts[AUG_IDX] ?? 0,
  );
  const accruedWithout = r2(
    reportNoAugPayroll.rows.find((r) => r.key === "accrued-wages-payable")?.amounts[AUG_IDX] ?? 0,
  );
  const reWith = r2(report.rows.find((r) => r.key === "retained-earnings")?.amounts[AUG_IDX] ?? 0);
  const reWithout = r2(
    reportNoAugPayroll.rows.find((r) => r.key === "retained-earnings")?.amounts[AUG_IDX] ?? 0,
  );
  console.log({
    accruedWagesWithPayroll: accruedWith,
    accruedWagesWithoutPayroll: accruedWithout,
    accruedDelta: r2(accruedWith - accruedWithout),
    retainedEarningsWith: reWith,
    retainedEarningsWithout: reWithout,
    retainedEarningsDelta: r2(reWith - reWithout),
    totalAssetsWith: r2(report.totalAssets[AUG_IDX] ?? 0),
    totalAssetsWithout: r2(reportNoAugPayroll.totalAssets[AUG_IDX] ?? 0),
    totalLEWith: r2(report.totalLiabilitiesAndEquity[AUG_IDX] ?? 0),
    totalLEWithout: r2(reportNoAugPayroll.totalLiabilitiesAndEquity[AUG_IDX] ?? 0),
  });

  console.log("\n=== 3. Counterfactual: payroll contribution to August +8 ===\n");
  console.log({ julyDiff: r2(julCheck.difference), augustDiff: r2(augCheck.difference) });

  const augNoPayroll = getBalanceCheckForPeriod(reportNoAugPayroll, AUG_IDX);
  console.log({
    augustWithPayroll: r2(augCheck.difference),
    augustWithoutPayroll: r2(augNoPayroll.difference),
    payrollAloneAddsToDiff: r2(augCheck.difference - augNoPayroll.difference),
  });

  const payrollDeltas = [];
  for (const row of report.rows) {
    if (row.kind !== "data") continue;
    const withAmt = r2(row.amounts[AUG_IDX] ?? 0);
    const withoutRow = reportNoAugPayroll.rows.find((r) => r.key === row.key);
    const withoutAmt = r2(withoutRow?.amounts[AUG_IDX] ?? 0);
    const delta = r2(withAmt - withoutAmt);
    if (Math.abs(delta) > 0.001) {
      payrollDeltas.push({ label: row.label, withoutPayroll: withoutAmt, withPayroll: withAmt, delta });
    }
  }
  payrollDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log("\nRows moved by August payroll postings only:");
  for (const d of payrollDeltas) {
    console.log(`  ${d.label}: ${d.withoutPayroll} → ${d.withPayroll} (Δ ${d.delta})`);
  }

  const assetSide = ["Cash", "Receivable", "Fixed Assets", "Inventory", "WHT Receivable", "Net VAT Receivable"];
  let dAssets = 0;
  let dLE = 0;
  for (const d of payrollDeltas) {
    if (assetSide.some((a) => d.label.includes(a))) dAssets += d.delta;
    else dLE += d.delta;
  }
  console.log("\nPayroll-only Δ Assets vs Δ L+E:", {
    deltaAssets: r2(dAssets),
    deltaLiabilitiesAndEquity: r2(dLE),
    imbalanceFromPayroll: r2(dAssets - dLE),
  });

  const { data: augTaxRows } = await admin
    .from("tax_ledger_entries")
    .select("entry_date, period_month, direction, tax_component, tax_amount, status, source_id")
    .eq("tenant_id", DAVORS)
    .eq("source_id", augTaxSrc);

  console.log("\n=== 4. August tax ledger legs (dates matter for BS cutoff) ===");
  console.log(augTaxRows);

  const augSal = expenses.find((e) => e.receipt_no === "PAYROLL-SAL-2026-08");
  const augEssnit = expenses.find((e) => e.receipt_no === "PAYROLL-ESSNIT-2026-08");
  const paye = r2(
    (augTaxRows ?? [])
      .filter((t) => t.tax_component === "paye")
      .reduce((s, t) => s + Number(t.tax_amount), 0),
  );
  const ssnit = r2(
    (augTaxRows ?? [])
      .filter((t) =>
        ["ssnit_employee", "ssnit_employer_tier1", "ssnit_tier2"].includes(t.tax_component),
      )
      .reduce((s, t) => s + Number(t.tax_amount), 0),
  );
  const augNet = r2(
    sumNetPayByPayrollMonth(
      payrollHistory.filter((e) => String(e.payroll_month).slice(0, 7) === "2026-08"),
    ).get("2026-08-01") ?? 0,
  );

  console.log("\n=== 5. Textbook identity for partial lock (should sum to 0) ===");
  const expHit = r2(-(Number(augSal?.amount) || 0) - (Number(augEssnit?.amount) || 0));
  const liabHit = r2(augNet + paye + ssnit);
  console.log({
    pnlExpenses: { staffSalaries: r2(Number(augSal?.amount) || 0), employerSsnit: r2(Number(augEssnit?.amount) || 0) },
    liabilities: { accruedWages: augNet, paye, ssnit },
    equityDownFromExpenses: expHit,
    liabilitiesUp: liabHit,
    netShouldBeZero: r2(expHit + liabHit),
    grossMinusNet: r2((Number(augSal?.amount) || 0) - augNet),
    employeeStatutoryInTax: r2(
      paye + Number((augTaxRows ?? []).find((t) => t.tax_component === "ssnit_employee")?.tax_amount || 0),
    ),
  });

  console.log("\n=== 6. Systemic test: simulate July WITH finance postings (+ tax) ===\n");
  const julyPaye = r2(julyHistRows.reduce((s, e) => s + (Number(e.paye_tax) || 0), 0));
  const julySsnit = r2(
    julyHistRows.reduce(
      (s, e) =>
        s +
        (Number(e.employee_ssnit) || 0) +
        (Number(e.employer_ssnit) || 0) +
        (Number(e.tier2) || 0),
      0,
    ),
  );
  const julySimExpenses = [
    ...expenses,
    {
      date: "2026-07-31",
      expense_category: "Staff Salaries",
      sub_category: "Payroll",
      amount: julyGross,
      payment_status: "Accrued - Not Yet Paid",
      description: "Auto-posted from Payroll July 2026",
      receipt_no: "PAYROLL-SAL-2026-07",
      notes: null,
    },
    {
      date: "2026-07-31",
      expense_category: "Employer SSNIT Contribution",
      sub_category: "Payroll",
      amount: julyErSsnit,
      payment_status: "Accrued - Not Yet Paid",
      description: "Auto-posted from Payroll July 2026",
      receipt_no: "PAYROLL-ESSNIT-2026-07",
      notes: null,
    },
  ];
  const julySimTax = [
    ...(data.initialTaxLedgerEntries ?? []),
    {
      entry_date: "2026-07-31",
      period_month: "2026-07-01",
      direction: "statutory_payable",
      tax_component: "paye",
      tax_amount: julyPaye,
      status: "open",
    },
    {
      entry_date: "2026-07-31",
      period_month: "2026-07-01",
      direction: "statutory_payable",
      tax_component: "ssnit_employee",
      tax_amount: r2(julyHistRows.reduce((s, e) => s + (Number(e.employee_ssnit) || 0), 0)),
      status: "open",
    },
    {
      entry_date: "2026-07-31",
      period_month: "2026-07-01",
      direction: "statutory_payable",
      tax_component: "ssnit_employer_tier1",
      tax_amount: r2(julyHistRows.reduce((s, e) => s + (Number(e.employer_ssnit) || 0), 0)),
      status: "open",
    },
    {
      entry_date: "2026-07-31",
      period_month: "2026-07-01",
      direction: "statutory_payable",
      tax_component: "ssnit_tier2",
      tax_amount: r2(julyHistRows.reduce((s, e) => s + (Number(e.tier2) || 0), 0)),
      status: "open",
    },
  ];

  const julySimReport = buildReport(data, payrollHistory, julySimExpenses, julySimTax);
  const julySimDiff = r2(getBalanceCheckForPeriod(julySimReport, JUL_IDX).difference);
  const julySimAccrued = r2(
    calculateAccruedWagesPayableByMonth(payrollHistory, julySimExpenses, FY, mec)[JUL_IDX],
  );

  console.log({
    julyActualDiff: r2(julCheck.difference),
    julyWithSimulatedFinancePostings: {
      bsDiff: julySimDiff,
      accruedWages: julySimAccrued,
      expectedAccruedWages: julyNet,
      grossMinusNetGap: r2(julyGross - julyNet),
      payePayableJul: r2(
        julySimReport.rows.find((r) => r.key === "paye-payable")?.amounts[JUL_IDX] ?? 0,
      ),
      ssnitPayableJul: r2(
        julySimReport.rows.find((r) => r.key === "ssnit-payable")?.amounts[JUL_IDX] ?? 0,
      ),
      retainedEarningsJul: r2(
        julySimReport.rows.find((r) => r.key === "retained-earnings")?.amounts[JUL_IDX] ?? 0,
      ),
      accruedJul: r2(
        julySimReport.rows.find((r) => r.key === "accrued-wages-payable")?.amounts[JUL_IDX] ?? 0,
      ),
    },
    systemicPattern:
      julySimDiff === r2(julyGross - julyNet)
        ? "BS gap equals gross−net when tax legs omitted or mis-dated"
        : `July simulated diff=${julySimDiff} (compare to gross−net=${r2(julyGross - julyNet)}, gross=${julyGross})`,
  });

  console.log("\n=== 7. Full August BS row snapshot (find +8) ===\n");
  for (const row of report.rows) {
    if (row.kind === "section") continue;
    const amt = r2(row.amounts[AUG_IDX] ?? 0);
    console.log(`  ${row.label}: ${amt}`);
  }
  console.log({
    totalAssets: r2(report.totalAssets[AUG_IDX] ?? 0),
    totalLiabilitiesAndEquity: r2(report.totalLiabilitiesAndEquity[AUG_IDX] ?? 0),
    difference: r2(augCheck.difference),
  });

  console.log("\n=== 7b. July vs August delta by row (non-payroll + payroll) ===\n");
  for (const row of report.rows) {
    if (row.kind !== "data") continue;
    const jul = r2(row.amounts[JUL_IDX] ?? 0);
    const aug = r2(row.amounts[AUG_IDX] ?? 0);
    const delta = r2(aug - jul);
    if (Math.abs(delta) > 0.001) {
      console.log(`  ${row.label}: Jul=${jul} → Aug=${aug} (Δ ${delta})`);
    }
  }

  console.log("\n=== 8. Live-recalc net vs locked history net (August) ===\n");
  const augHistRows = (data.initialPayrollHistory ?? []).filter(
    (e) => String(e.payroll_month).slice(0, 7) === "2026-08",
  );
  const { buildLiveOpenMonthPayrollWagesEntries } = await import(
    "../app/dashboard/hr-payroll/payroll-live-recalc-utils"
  );
  const liveEntries = buildLiveOpenMonthPayrollWagesEntries(
    augHistRows,
    liveBundle.employees,
    liveBundle.liveContext,
    [],
  );
  const liveNet = r2(liveEntries.reduce((s, e) => s + (Number(e.net_pay) || 0), 0));
  const histNet = r2(augHistRows.reduce((s, e) => s + (Number(e.net_pay) || 0), 0));
  console.log({
    lockedHistoryNet: histNet,
    liveRecalcNetFromHistoryAsProcessing: liveNet,
    delta: r2(histNet - liveNet),
    note: "If delta=8, open-month live path would disagree with lock snapshot",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
