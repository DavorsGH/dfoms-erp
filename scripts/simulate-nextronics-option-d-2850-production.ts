/**
 * Simulate Option D true-up for Nextronics Jun/Jul 2026 +2,850 BS gap.
 * Read-only against production data; injects synthetic rows in-memory only.
 *
 *   npx tsx scripts/simulate-nextronics-option-d-2850-production.ts
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

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const NEXTRONICS = "da8b968e-dd42-48d5-93c5-a3147ff5de72";
const FY = 2026;
const GAP = 2850;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];

function loadEnv(f: string) {
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

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function buildReport(data, payrollHistory, extraIncome = [], extraExpenses = [], extraManual = []) {
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
    [...data.initialIncomeEntries, ...extraIncome],
    [...data.initialExpenseEntries, ...extraExpenses],
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    cashFlowExpenseEntries,
    payrollHistory,
    data.initialMonthEndCloseNetPay,
    FY,
    data.initialInventoryBalanceSheet,
    [...data.initialManualEntries, ...extraManual],
    data.initialTaxLedgerEntries,
    {
      tenantId: NEXTRONICS,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );
}

function monthSnapshot(report, idx: number, label: string) {
  const check = getBalanceCheckForPeriod(report, idx);
  const row = (key: string) =>
    r2(getBalanceSheetAmountForMonth(report.rows.find((r) => r.key === key)!, idx));
  return {
    label,
    diff: r2(check.difference),
    balanced: check.isBalanced,
    total_assets: r2(check.totalAssets),
    total_le: r2(check.totalLiabilitiesAndEquity),
    cash: row("cash"),
    inventory: row("inventory"),
    retained_earnings: row("retained-earnings"),
    inventory_opening_equity: row("inventory-opening-equity"),
    share_capital: row("share-capital"),
    other_ltl: row("other-long-term-liabilities"),
    directors_loan: row("directors-loan"),
  };
}

function printComparison(title: string, baseline, adjusted, indices: number[]) {
  console.log(`\n=== ${title} ===`);
  for (const idx of indices) {
    const b = monthSnapshot(baseline, idx, MONTHS[idx]!);
    const a = monthSnapshot(adjusted, idx, MONTHS[idx]!);
    console.log(`\n${MONTHS[idx]} 2026:`);
    console.log("  Baseline:", b);
    console.log("  Adjusted:", a);
    console.log("  RE delta:", r2(a.retained_earnings - b.retained_earnings));
    console.log("  Aug+ RE match baseline:", idx >= 7 ? a.retained_earnings === b.retained_earnings : "n/a");
  }
}

async function main() {
  loadEnv(resolve(".env.local.backup"));
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const data = await fetchBalanceSheetPageData(admin, NEXTRONICS);
  const liveBundle = await fetchPayrollLiveRecalcBundle(admin, { tenantId: NEXTRONICS });
  const payrollHistory = mergePayrollWagesWithLiveOpenMonths(
    data.initialPayrollHistory,
    data.initialPayrollProcessingRows,
    liveBundle.employees,
    liveBundle.liveContext,
  );

  const baseline = buildReport(data, payrollHistory);
  console.log("=== BASELINE (production today) ===");
  for (const idx of [5, 6, 7, 8]) {
    console.log(monthSnapshot(baseline, idx, MONTHS[idx]!));
  }

  // --- Scenario A: System adjustment income + non-cash expense reversal (RECOMMENDED) ---
  const scenarioAIncome = [
    {
      date: "2026-06-01",
      amount: GAP,
      amount_received: 0,
      outstanding_balance: 0,
      service_category: "Other Income",
      entry_type: "service",
      sale_status: null,
      net_of_tax_amount: GAP,
      output_vat_amount: 0,
      is_system_adjustment: true,
      description:
        "Prior-period inventory recognition — pre-go-live COGS consumed untracked inventory (Jun 2026 sales)",
      invoice_no: "ADJ-PPIR-2026-06",
    },
  ];
  const scenarioAExpense = [
    {
      date: "2026-08-05",
      amount: GAP,
      payment_status: "Non-Cash",
      expense_category: "Other Expenses",
      sub_category: "Inventory Go-Live True-Up",
      receipt_no: "ADJ-PPIR-REV-2026-08",
      description:
        "Reversal of prior-period inventory recognition — inventory asset tracking active from go-live; historical COGS now in valuation history",
      notes: "Non-cash equity true-up reversal; paired with ADJ-PPIR-2026-06",
    },
  ];
  const scenarioA = buildReport(data, payrollHistory, scenarioAIncome, scenarioAExpense);
  printComparison("SCENARIO A — system adjustment income + non-cash expense reversal", baseline, scenarioA, [5, 6, 7, 8]);

  // --- Scenario A variant: negative system adjustment income for reversal ---
  const scenarioA2Income = [
    ...scenarioAIncome,
    {
      date: "2026-08-05",
      amount: -GAP,
      amount_received: 0,
      outstanding_balance: 0,
      service_category: "Other Income",
      entry_type: "service",
      sale_status: null,
      net_of_tax_amount: -GAP,
      output_vat_amount: 0,
      is_system_adjustment: true,
      description: "Reversal of ADJ-PPIR-2026-06 at inventory go-live",
      invoice_no: "ADJ-PPIR-REV-2026-08",
    },
  ];
  const scenarioA2 = buildReport(data, payrollHistory, scenarioA2Income);
  printComparison("SCENARIO A2 — two system adjustment income rows (+Jun, -Aug)", baseline, scenarioA2, [5, 6, 7, 8]);

  // --- Scenario B: manual_financial_entries retained_earnings_prior_years (NOT WIRED) ---
  const scenarioBManual = [
    {
      period_month: "2026-06-01",
      retained_earnings_prior_years: GAP,
      notes: "TEST: prior-period inventory recognition (legacy column — expect no effect)",
    },
    {
      period_month: "2026-08-01",
      retained_earnings_prior_years: 0,
      notes: "TEST: reversal",
    },
  ];
  const scenarioB = buildReport(data, payrollHistory, [], [], scenarioBManual);
  printComparison("SCENARIO B — manual retained_earnings_prior_years (legacy, unwired)", baseline, scenarioB, [5, 6, 7, 8]);

  // --- Scenario C: manual other_long_term_liabilities non-cash (mechanical, misclassified) ---
  const scenarioCManual = [
    {
      period_month: "2026-06-01",
      other_long_term_liabilities: GAP,
      notes: "[Non-cash] Prior-period inventory recognition placeholder (liability misclassification)",
    },
    {
      period_month: "2026-08-01",
      other_long_term_liabilities: 0,
      notes: "[Non-cash] Reversal at inventory go-live",
    },
  ];
  const scenarioC = buildReport(data, payrollHistory, [], [], scenarioCManual);
  printComparison("SCENARIO C — manual other_long_term_liabilities stock (non-cash)", baseline, scenarioC, [5, 6, 7, 8]);

  // --- Scenario D: opening_inventory_value bump only (WRONG — user asked to confirm) ---
  const dataOpeningBump = {
    ...data,
    initialInventoryBalanceSheet: {
      ...data.initialInventoryBalanceSheet,
      config: data.initialInventoryBalanceSheet.config
        ? {
            ...data.initialInventoryBalanceSheet.config,
            opening_inventory_value: GAP,
          }
        : null,
    },
  };
  const scenarioD = buildReport(dataOpeningBump, payrollHistory);
  printComparison("SCENARIO D — opening_inventory_value=2850 only (NOT Option D)", baseline, scenarioD, [5, 6, 7, 8]);

  console.log("\n=== RECOMMENDED ENTRY SPEC (Scenario A — if approved) ===");
  console.log(
    JSON.stringify(
      {
        entry_1: {
          table: "income_register",
          date: "2026-06-01",
          invoice_no: "ADJ-PPIR-2026-06",
          entry_type: "service",
          service_category: "Other Income",
          amount: GAP,
          amount_received: 0,
          outstanding_balance: 0,
          payment_status: "Non-Cash",
          tax_inclusive: true,
          net_of_tax_amount: GAP,
          output_vat_amount: 0,
          wht_amount: 0,
          is_system_adjustment: true,
          description:
            "Prior-Period Inventory Recognition — acknowledges inventory cost consumed by Jun 2026 product sales before inventory go-live (2026-08-05)",
        },
        entry_2: {
          table: "expense_register",
          date: "2026-08-05",
          receipt_no: "ADJ-PPIR-REV-2026-08",
          expense_category: "Other Expenses",
          sub_category: "Inventory Go-Live True-Up",
          amount: GAP,
          payment_status: "Non-Cash",
          description:
            "Reversal of ADJ-PPIR-2026-06 — inventory asset tracking from go-live; Jun COGS already in valuation history",
        },
        rationale:
          "Matches existing non-cash system adjustment pattern (PAYROLL-DEDSAV). Equity effect via Retained Earnings. No cash impact. August RE returns to baseline.",
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
