/**
 * Read-only: compare Dashboard BS Check path vs Finance Balance Sheet path
 * for Davors tenant FY2026 August.
 *
 * Usage:
 *   npx tsx scripts/probe-dashboard-bs-check-aug2026-production.ts --env-file .env.local.backup --allow-production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";
import type { PayrollProcessingRow } from "../app/dashboard/hr-payroll/payroll-processing-utils";
import type { PayrollHistoryWagesEntry } from "../app/dashboard/finance/accrued-wages-utils";
import type {
  AccountsPayablePaymentRow,
  DirectorsLoanRepaymentRow,
} from "../app/dashboard/finance/directors-loan-utils";
import { buildMonthlyCashComponents } from "../app/dashboard/finance/cash-movement-utils";
import { buildNetPayByPayrollMonth } from "../app/dashboard/finance/accrued-wages-utils";

const PRODUCTION = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const AUGUST_INDEX = 7;

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
  const args = process.argv.slice(2);
  let envFile = ".env.local.backup";
  let allowProduction = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--env-file" && args[i + 1]) {
      envFile = args[i + 1]!;
      i += 1;
    } else if (args[i] === "--allow-production") {
      allowProduction = true;
    }
  }
  return { envFile, allowProduction };
}

/** Mirrors dashboard-utils buildBalanceSheetReportForYear — no reportOptions. */
function buildDashboardBalanceSheetReport(
  ...args: Parameters<typeof buildBalanceSheetReport>
) {
  const [
    incomeEntries,
    expenseEntries,
    fixedAssets,
    payableEntries,
    capitalContributions,
    cashFlowExpenseEntries,
    payrollHistory,
    monthEndCloseNetPay,
    financialYear,
    inventoryInput,
    manualEntries,
    taxLedgerEntries,
  ] = args;
  return buildBalanceSheetReport(
    incomeEntries,
    expenseEntries,
    fixedAssets,
    payableEntries,
    capitalContributions,
    cashFlowExpenseEntries,
    payrollHistory,
    monthEndCloseNetPay,
    financialYear,
    inventoryInput,
    manualEntries,
    taxLedgerEntries,
  );
}

function rowDiffs(
  dashboardReport: ReturnType<typeof buildBalanceSheetReport>,
  fullReport: ReturnType<typeof buildBalanceSheetReport>,
  monthIndex: number,
) {
  const diffs: Array<{ key: string; label: string; dashboard: number; full: number; delta: number }> =
    [];
  for (const row of fullReport.rows) {
    if (row.kind === "section") continue;
    const dash = getBalanceSheetAmountForMonth(
      dashboardReport.rows.find((r) => r.key === row.key) ?? row,
      monthIndex,
    );
    const fullAmt = getBalanceSheetAmountForMonth(row, monthIndex);
    const delta = r2(dash - fullAmt);
    if (Math.abs(delta) > 0.001) {
      diffs.push({
        key: row.key,
        label: row.label,
        dashboard: dash,
        full: fullAmt,
        delta,
      });
    }
  }
  return diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

async function main() {
  const { envFile, allowProduction } = parseArgs();
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION)) {
    throw new Error(`Refusing non-production URL: ${url}`);
  }
  if (!allowProduction) {
    throw new Error("Pass --allow-production to run against production");
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const tenantId = DAVORS_TENANT_ID;

  const [
    { data: incomeEntries },
    { data: expenseEntries },
    { data: fixedAssets },
    { data: payableEntries },
    { data: apPayments },
    { data: directorsLoanRepayments },
    { data: capitalContributions },
    { data: manualEntries },
    { data: payrollHistory },
    { data: payrollProcessing },
    { data: monthEndCloseRecords },
    { data: taxLedgerEntries },
    inventoryBalanceSheetInput,
    livePayrollBundle,
  ] = await Promise.all([
    admin
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
      )
      .eq("tenant_id", tenantId)
      .order("date", { ascending: true }),
    admin
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", tenantId)
      .order("date", { ascending: true }),
    admin
      .from("fixed_assets")
      .select(
        "tenant_id, original_cost, quantity, useful_life_years, purchase_date, depreciation_method, payment_method",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("accounts_payable")
      .select(
        "invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("accounts_payable_payments")
      .select("tenant_id, payment_date, amount, payment_source")
      .eq("tenant_id", tenantId),
    admin
      .from("directors_loan_repayments")
      .select(
        "tenant_id, repayment_date, amount, applied_to_ap_component, applied_to_manual_component",
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
    admin.from("payroll_processing").select("*").eq("tenant_id", tenantId),
    admin.from("month_end_close").select("month, total_net_pay").eq("tenant_id", tenantId),
    admin
      .from("tax_ledger_entries")
      .select("entry_date, direction, tax_component, tax_amount, status")
      .eq("tenant_id", tenantId)
      .eq("status", "open"),
    fetchInventoryBalanceSheetInput(admin, tenantId),
    fetchPayrollLiveRecalcBundle(admin, { tenantId }),
  ]);

  const cashFlowExpenseEntries =
    expenseEntries?.map((entry) => ({
      date: entry.date,
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      amount: entry.amount,
      payment_status: entry.payment_status,
      description: entry.description ?? null,
      receipt_no: entry.receipt_no ?? null,
      notes: entry.notes ?? null,
    })) ?? [];

  const payrollHistoryWages = mergePayrollWagesWithLiveOpenMonths(
    (payrollHistory as PayrollHistoryWagesEntry[] | null) ?? [],
    (payrollProcessing as PayrollProcessingRow[] | null) ?? [],
    livePayrollBundle.employees,
    livePayrollBundle.liveContext,
  );

  const monthEndCloseNetPay =
    monthEndCloseRecords?.map((record) => ({
      month: record.month,
      total_net_pay: record.total_net_pay,
    })) ?? [];

  const reportOptions = {
    tenantId,
    accountsPayablePayments: (apPayments as AccountsPayablePaymentRow[] | null) ?? [],
    directorsLoanRepayments:
      (directorsLoanRepayments as DirectorsLoanRepaymentRow[] | null) ?? [],
  };

  const fullReport = buildBalanceSheetReport(
    incomeEntries ?? [],
    expenseEntries ?? [],
    fixedAssets ?? [],
    payableEntries ?? [],
    capitalContributions ?? [],
    cashFlowExpenseEntries,
    payrollHistoryWages,
    monthEndCloseNetPay,
    FY,
    inventoryBalanceSheetInput,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
    reportOptions,
  );

  const dashboardFixedAssets = (fixedAssets ?? []).map(
    ({ original_cost, quantity, useful_life_years, purchase_date, depreciation_method }) => ({
      original_cost,
      quantity,
      useful_life_years,
      purchase_date,
      depreciation_method,
    }),
  );

  const dashboardReportExact = buildDashboardBalanceSheetReport(
    incomeEntries ?? [],
    expenseEntries ?? [],
    dashboardFixedAssets,
    payableEntries ?? [],
    capitalContributions ?? [],
    cashFlowExpenseEntries,
    payrollHistoryWages,
    monthEndCloseNetPay,
    FY,
    inventoryBalanceSheetInput,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
  );

  const dashExactAug = getBalanceCheckForPeriod(dashboardReportExact, AUGUST_INDEX);
  console.log("\n--- Dashboard-exact fetch shape (no payment_method on FA) ---");
  console.log({
    difference: r2(dashExactAug.difference),
    absDifference: r2(Math.abs(dashExactAug.difference)),
    widgetLabel: `Out of balance by GHS ${Math.abs(dashExactAug.difference).toFixed(2)}`,
    cash: r2(
      dashboardReportExact.rows.find((r) => r.key === "cash")?.amounts[AUGUST_INDEX] ??
        0,
    ),
  });
  console.log("Dashboard-exact August row diffs:");
  for (const d of rowDiffs(dashboardReportExact, fullReport, AUGUST_INDEX)) {
    console.log(
      `  ${d.label}: dashboard=${d.dashboard.toFixed(2)} full=${d.full.toFixed(2)} delta=${d.delta.toFixed(2)}`,
    );
  }

  const dashboardReport = buildDashboardBalanceSheetReport(
    incomeEntries ?? [],
    expenseEntries ?? [],
    fixedAssets ?? [],
    payableEntries ?? [],
    capitalContributions ?? [],
    cashFlowExpenseEntries,
    payrollHistoryWages,
    monthEndCloseNetPay,
    FY,
    inventoryBalanceSheetInput,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
  );

  const dashAug = getBalanceCheckForPeriod(dashboardReport, AUGUST_INDEX);
  const fullAug = getBalanceCheckForPeriod(fullReport, AUGUST_INDEX);
  const dashDec = getBalanceCheckForPeriod(dashboardReport, FULL_YEAR_INDEX);
  const fullDec = getBalanceCheckForPeriod(fullReport, FULL_YEAR_INDEX);

  console.log("=== Davors FY2026 Dashboard vs Full BS path ===\n");
  console.log("AP payments (directors_loan source):");
  for (const p of reportOptions.accountsPayablePayments.filter(
    (x) => x.payment_source === "directors_loan",
  )) {
    console.log(`  ${p.payment_date} amount=${p.amount}`);
  }
  console.log("\nDirector loan repayments:");
  for (const r of reportOptions.directorsLoanRepayments) {
    console.log(
      `  ${r.repayment_date} amount=${r.amount} ap=${r.applied_to_ap_component ?? 0} manual=${r.applied_to_manual_component ?? 0}`,
    );
  }

  console.log("\n--- August 2026 balance check ---");
  console.log("Dashboard path:", {
    totalAssets: r2(dashAug.totalAssets),
    totalLiabilitiesAndEquity: r2(dashAug.totalLiabilitiesAndEquity),
    difference: r2(dashAug.difference),
    isBalanced: dashAug.isBalanced,
  });
  console.log("Full BS path:", {
    totalAssets: r2(fullAug.totalAssets),
    totalLiabilitiesAndEquity: r2(fullAug.totalLiabilitiesAndEquity),
    difference: r2(fullAug.difference),
    isBalanced: fullAug.isBalanced,
  });

  console.log("\n--- December FY snapshot balance check ---");
  console.log("Dashboard path:", {
    difference: r2(dashDec.difference),
    isBalanced: dashDec.isBalanced,
  });
  console.log("Full BS path:", {
    totalAssets: r2(fullDec.totalAssets),
    totalLiabilitiesAndEquity: r2(fullDec.totalLiabilitiesAndEquity),
    difference: r2(fullDec.difference),
    isBalanced: fullDec.isBalanced,
  });

  console.log("\n--- All months: dashboard path balance check diff ---");
  for (let i = 0; i < 12; i += 1) {
    const dash = getBalanceCheckForPeriod(dashboardReport, i);
    const full = getBalanceCheckForPeriod(fullReport, i);
    console.log(
      `Month ${i + 1}: dashboard diff=${r2(dash.difference).toFixed(2)} full diff=${r2(full.difference).toFixed(2)} cash dash=${r2(dashboardReport.rows.find((r) => r.key === "cash")?.amounts[i] ?? 0).toFixed(2)} full=${r2(fullReport.rows.find((r) => r.key === "cash")?.amounts[i] ?? 0).toFixed(2)}`,
    );
  }

  const staffMap = buildNetPayByPayrollMonth(payrollHistoryWages, monthEndCloseNetPay);
  const dashCashComponents = buildMonthlyCashComponents(
    {
      tenantId: "",
      incomeEntries: incomeEntries ?? [],
      expenseEntries: cashFlowExpenseEntries,
      capitalContributions: capitalContributions ?? [],
      fixedAssets: fixedAssets ?? [],
      rawMaterialCashPurchases: inventoryBalanceSheetInput.cashPurchases,
      productCashPurchases: inventoryBalanceSheetInput.productCashPurchases,
      inventoryConfig: inventoryBalanceSheetInput.config,
      manualEntries: manualEntries ?? [],
      accountsPayableSettlements: payableEntries ?? [],
      staffSalaryNetByPayrollMonth: staffMap,
    },
    FY,
  );
  const fullCashComponents = buildMonthlyCashComponents(
    {
      tenantId,
      incomeEntries: incomeEntries ?? [],
      expenseEntries: cashFlowExpenseEntries,
      capitalContributions: capitalContributions ?? [],
      fixedAssets: fixedAssets ?? [],
      rawMaterialCashPurchases: inventoryBalanceSheetInput.cashPurchases,
      productCashPurchases: inventoryBalanceSheetInput.productCashPurchases,
      inventoryConfig: inventoryBalanceSheetInput.config,
      manualEntries: manualEntries ?? [],
      accountsPayableSettlements: payableEntries ?? [],
      accountsPayablePayments: reportOptions.accountsPayablePayments,
      directorsLoanRepayments: reportOptions.directorsLoanRepayments,
      staffSalaryNetByPayrollMonth: staffMap,
    },
    FY,
  );

  console.log("\n--- August cash outflow component diffs (dashboard − full) ---");
  const outflowKeys = [
    "paidExpenses",
    "loanRepayments",
    "rawMaterialPurchases",
    "productPurchases",
    "accountsPayableSettlements",
    "directorsLoanRepayments",
    "fixedAssetPurchases",
  ] as const;
  for (const key of outflowKeys) {
    const dash = r2(dashCashComponents[key][AUGUST_INDEX] ?? 0);
    const full = r2(fullCashComponents[key][AUGUST_INDEX] ?? 0);
    const delta = r2(dash - full);
    if (Math.abs(delta) > 0.001) {
      console.log(`${key}: dashboard=${dash.toFixed(2)} full=${full.toFixed(2)} delta=${delta.toFixed(2)}`);
    }
  }
  console.log("AP payments total:", reportOptions.accountsPayablePayments.length);
  console.log(
    "company_cash AP payments sum:",
    r2(
      reportOptions.accountsPayablePayments
        .filter((p) => p.payment_source === "company_cash")
        .reduce((s, p) => s + (Number(p.amount) || 0), 0),
    ),
  );

  const creditFaCost = (fixedAssets ?? [])
    .filter((a) => String(a.payment_method ?? "").toLowerCase().includes("credit"))
    .reduce(
      (s, a) =>
        s + (Number(a.original_cost) || 0) * (Number(a.quantity) || 0),
      0,
    );
  const cashFaCost = (fixedAssets ?? [])
    .filter((a) => !String(a.payment_method ?? "").toLowerCase().includes("credit"))
    .reduce(
      (s, a) =>
        s + (Number(a.original_cost) || 0) * (Number(a.quantity) || 0),
      0,
    );
  console.log("Fixed assets FY2026: credit-total=", r2(creditFaCost), "non-credit-total=", r2(cashFaCost));

  console.log("\n--- August line-by-line diffs (dashboard − full) ---");
  const diffs = rowDiffs(dashboardReport, fullReport, AUGUST_INDEX);
  if (diffs.length === 0) {
    console.log("No row differences.");
  } else {
    for (const d of diffs) {
      console.log(
        `${d.label} (${d.key}): dashboard=${d.dashboard.toFixed(2)} full=${d.full.toFixed(2)} delta=${d.delta.toFixed(2)}`,
      );
    }
    const assetSideDelta = diffs
      .filter((d) =>
        [
          "cash",
          "accounts-receivable",
          "wht-receivable",
          "net-vat-receivable",
          "fixed-assets-net",
          "inventory",
        ].includes(d.key),
      )
      .reduce((s, d) => s + d.delta, 0);
    const liabilitySideDelta = diffs
      .filter((d) =>
        [
          "accounts-payable",
          "accrued-wages-payable",
          "wht-payable",
          "net-vat-payable",
          "paye-payable",
          "ssnit-payable",
          "bank-loans",
          "other-long-term-liabilities",
          "directors-loan",
          "share-capital",
          "retained-earnings",
          "inventory-opening-equity",
        ].includes(d.key),
      )
      .reduce((s, d) => s + d.delta, 0);
    console.log("\nNet asset-side delta:", r2(assetSideDelta));
    console.log("Net liability+equity delta:", r2(liabilitySideDelta));
    console.log(
      "Implied balance-check gap (assets − L+E):",
      r2(assetSideDelta - liabilitySideDelta),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
