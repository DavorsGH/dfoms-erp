/**
 * Staging validation for Dashboard lightweighting (Layers 1–4):
 * 1. Widget summary cards match full-fetch baseline (Davors, current month + YTD)
 * 2. BS Check parity vs Finance Balance Sheet (Davors + Caanta/Mimshack)
 * 3. Measured Supabase request counts (baseline vs optimized)
 *
 * Usage:
 *   npx tsx scripts/probe-dashboard-performance-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  fetchBalanceSheetPageData,
  payrollProcessingNeedsLiveRecalc,
} from "../app/dashboard/finance/balance-sheet-page-data";
import { fetchDashboardPageData } from "../app/dashboard/dashboard-page-data";
import {
  buildDashboardBalanceSheetCheck,
  buildDashboardViewModel,
} from "../app/dashboard/dashboard-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
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

function buildVmFromBalanceSheetData(
  tenantId: string,
  data: Awaited<ReturnType<typeof fetchBalanceSheetPageData>>,
  referenceDate: Date,
) {
  const reportOptions = {
    tenantId,
    accountsPayablePayments: data.initialAccountsPayablePayments,
    directorsLoanRepayments: data.initialDirectorsLoanRepayments,
  };

  return buildDashboardViewModel({
    incomeEntries: data.initialIncomeEntries.map((e) => ({
      date: e.date,
      amount: e.amount,
    })),
    productSaleEntries: data.initialIncomeEntries
      .filter((e) => e.entry_type === "product_sale")
      .map((e) => ({
        date: e.date,
        amount: e.amount,
        sale_status: e.sale_status,
      })),
    profitLossIncomeEntries: data.initialIncomeEntries.map((e) => ({
      date: e.date,
      service_category: e.service_category,
      amount: e.amount,
      entry_type: e.entry_type,
      sale_status: e.sale_status,
      net_of_tax_amount: (e as { net_of_tax_amount?: number | null })
        .net_of_tax_amount,
      output_vat_amount: (e as { output_vat_amount?: number | null })
        .output_vat_amount,
    })),
    balanceSheetIncomeEntries: data.initialIncomeEntries,
    expenseEntries: data.initialExpenseEntries.map((e) => ({
      date: e.date,
      amount: e.amount,
    })),
    profitLossExpenseEntries: data.initialExpenseEntries,
    fixedAssets: data.initialFixedAssets,
    payableEntries: data.initialPayableEntries,
    capitalContributions: data.initialCapitalContributions,
    cashFlowIncomeEntries: data.initialCashFlowIncomeEntries,
    cashFlowExpenseEntries: data.initialCashFlowExpenseEntries,
    payrollHistoryWages: data.initialPayrollHistory,
    monthEndCloseNetPay: data.initialMonthEndCloseNetPay,
    manualEntries: data.initialManualEntries,
    monthEndCloseRecords: data.initialMonthEndCloseRecords,
    payrollProcessingEntries: data.initialPayrollProcessingRows.map((e) => ({
      payroll_month: e.payroll_month,
      gross_pay: Number(e.gross_pay) || 0,
    })),
    payrollHistoryEntries: data.initialPayrollHistoryGrossEntries,
    inventoryBalanceSheetInput: data.initialInventoryBalanceSheet,
    taxLedgerEntries: data.initialTaxLedgerEntries,
    balanceSheetReportOptions: reportOptions,
    referenceDate,
  });
}

function snapshotSummaryCards(
  vm: ReturnType<typeof buildDashboardViewModel>,
  monthKey: string,
) {
  const snap = vm.monthSnapshots[monthKey]?.summary;
  if (!snap) return null;
  return {
    totalRevenue: r2(snap.totalRevenue),
    totalRevenueYtd: r2(snap.totalRevenueYtd),
    totalExpenses: r2(snap.totalExpenses),
    totalExpensesYtd: r2(snap.totalExpensesYtd),
    depreciation: r2(snap.depreciation),
    depreciationYtd: r2(snap.depreciationYtd),
    productSales: r2(snap.productSales),
    productSalesYtd: r2(snap.productSalesYtd),
    totalPurchases: r2(snap.totalPurchases),
    totalPurchasesYtd: r2(snap.totalPurchasesYtd),
    netProfit: r2(snap.netProfit),
    netProfitYtd: r2(snap.netProfitYtd),
    cashPosition: r2(snap.cashPosition),
    balanceCheckDiff: r2(snap.balanceCheck.difference),
    balanceCheckBalanced: snap.balanceCheck.isBalanced,
  };
}

async function countBaselineDashboardRequests(
  admin: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const counter = { count: 0 };
  await fetchBalanceSheetPageData(admin, tenantId, {
    dateRange: null,
    includePayrollLiveRecalc: true,
    requestCounter: counter,
  });
  counter.count += 1;
  await admin
    .from("income_register")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("entry_type", "product_sale")
    .limit(1);
  counter.count += 1;
  await admin.from("crm_sales").select("id").limit(1);
  counter.count += 1;
  return counter.count;
}

async function probeBsParity(
  admin: SupabaseClient,
  tenantId: string,
  tenantName: string,
) {
  const data = await fetchBalanceSheetPageData(admin, tenantId);
  const reportOptions = {
    tenantId,
    accountsPayablePayments: data.initialAccountsPayablePayments,
    directorsLoanRepayments: data.initialDirectorsLoanRepayments,
  };

  const financeReport = buildBalanceSheetReport(
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
    reportOptions,
  );

  const dashboardVm = buildVmFromBalanceSheetData(
    tenantId,
    data,
    new Date(`${FY}-08-15`),
  );

  const augustKey = dashboardVm.monthOptions.find(
    (o) => o.year === FY && o.month === 8,
  )?.key;
  const dashAugust = augustKey
    ? dashboardVm.monthSnapshots[augustKey]?.summary.balanceCheck
    : null;

  const financeAug = getBalanceCheckForPeriod(financeReport, AUGUST_INDEX);
  const financeDec = getBalanceCheckForPeriod(financeReport, FULL_YEAR_INDEX);

  const bsReportForWrapper = buildBalanceSheetReport(
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
    reportOptions,
  );
  const wrapperCheck = buildDashboardBalanceSheetCheck(
    bsReportForWrapper,
    AUGUST_INDEX,
  );

  const widgetMatchesFinance =
    dashAugust !== null &&
    r2(dashAugust.difference) === r2(financeAug.difference) &&
    dashAugust.isBalanced === financeAug.isBalanced;
  const wrapperMatchesFinance =
    r2(wrapperCheck.difference) === r2(financeAug.difference) &&
    wrapperCheck.isBalanced === financeAug.isBalanced;

  return {
    tenantName,
    tenantId,
    widgetMatchesFinance,
    wrapperMatchesFinance,
    august: {
      widgetDiff: dashAugust?.difference ?? null,
      financeDiff: r2(financeAug.difference),
      widgetBalanced: dashAugust?.isBalanced ?? null,
      financeBalanced: financeAug.isBalanced,
    },
    december: {
      financeDiff: r2(financeDec.difference),
      financeBalanced: financeDec.isBalanced,
    },
  };
}

async function main() {
  loadEnv(resolve(".env.staging.local"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING_REF)) {
    throw new Error(`Refusing non-staging URL: ${url} (expected ${STAGING_REF})`);
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  }) as SupabaseClient;

  const referenceDate = new Date(`${FY}-08-15`);
  let failures = 0;

  console.log("\n=== Dashboard performance probe (staging) ===\n");

  const baselineCounter = await countBaselineDashboardRequests(
    admin,
    DAVORS_TENANT_ID,
  );
  const optimizedCounter = { count: 0 };
  await fetchDashboardPageData(admin, DAVORS_TENANT_ID, {
    requestCounter: optimizedCounter,
  });

  const fullFetchCounter = { count: 0 };
  await fetchBalanceSheetPageData(admin, DAVORS_TENANT_ID, {
    dateRange: null,
    includePayrollLiveRecalc: true,
    requestCounter: fullFetchCounter,
  });

  const { data: payrollHistory } = await admin
    .from("payroll_history")
    .select("payroll_month")
    .eq("tenant_id", DAVORS_TENANT_ID);
  const { data: payrollProcessing } = await admin
    .from("payroll_processing")
    .select("payroll_month")
    .eq("tenant_id", DAVORS_TENANT_ID);
  const needsLiveRecalc = payrollProcessingNeedsLiveRecalc(
    payrollHistory ?? [],
    payrollProcessing ?? [],
  );

  console.log("--- Supabase request counts (Davors) ---");
  console.log(`Baseline (pre-change path):     ${baselineCounter} requests`);
  console.log(`Optimized (fetchDashboardPageData): ${optimizedCounter.count} requests`);
  console.log(`Full fetch (dateRange null, live recalc on): ${fullFetchCounter.count} requests`);
  console.log(`Payroll live recalc needed:     ${needsLiveRecalc ? "yes" : "no (skipped)"}`);
  console.log(
    `Request reduction (baseline → optimized): ${baselineCounter - optimizedCounter.count} (−${Math.round(((baselineCounter - optimizedCounter.count) / baselineCounter) * 100)}%)`,
  );

  console.log("\n--- Widget accuracy (Davors, Aug 2026 + YTD) ---");
  const baselineData = await fetchBalanceSheetPageData(admin, DAVORS_TENANT_ID, {
    dateRange: null,
    includePayrollLiveRecalc: true,
  });
  const optimizedData = await fetchDashboardPageData(admin, DAVORS_TENANT_ID);

  const baselineVm = buildVmFromBalanceSheetData(
    DAVORS_TENANT_ID,
    baselineData,
    referenceDate,
  );
  const optimizedVm = buildVmFromBalanceSheetData(
    DAVORS_TENANT_ID,
    optimizedData,
    referenceDate,
  );

  const augustKey =
    baselineVm.monthOptions.find((o) => o.year === FY && o.month === 8)?.key ??
    `${FY}-08`;

  const baselineCards = snapshotSummaryCards(baselineVm, augustKey);
  const optimizedCards = snapshotSummaryCards(optimizedVm, augustKey);

  if (!baselineCards || !optimizedCards) {
    console.log("FAIL: Could not resolve August snapshot.");
    failures += 1;
  } else {
    const cardKeys = Object.keys(baselineCards) as Array<
      keyof typeof baselineCards
    >;
    let cardMismatches = 0;
    for (const key of cardKeys) {
      const before = baselineCards[key];
      const after = optimizedCards[key];
      const match =
        typeof before === "number" && typeof after === "number"
          ? before === after
          : before === after;
      if (!match) {
        cardMismatches += 1;
        console.log(`  MISMATCH ${key}: baseline=${before} optimized=${after}`);
      }
    }
    if (cardMismatches === 0) {
      console.log(`PASS: All ${cardKeys.length} summary fields match for ${augustKey}.`);
      console.log(
        `  netProfit=${optimizedCards.netProfit}, cash=${optimizedCards.cashPosition}, BS diff=${optimizedCards.balanceCheckDiff}`,
      );
    } else {
      console.log(`FAIL: ${cardMismatches} summary field(s) differ.`);
      failures += 1;
    }
  }

  console.log(
    `\nIncome rows: baseline=${baselineData.initialIncomeEntries.length} optimized=${optimizedData.initialIncomeEntries.length}`,
  );
  console.log(
    `Expense rows: baseline=${baselineData.initialExpenseEntries.length} optimized=${optimizedData.initialExpenseEntries.length}`,
  );
  console.log(
    `Sales analysis rows: optimized=${optimizedData.salesAnalysisEntries.length}`,
  );

  console.log("\n--- BS Check parity (Dashboard widget vs Finance) ---");
  const tenants = [{ id: DAVORS_TENANT_ID, name: "Davors" }];
  const { data: caanta } = await admin
    .from("tenants")
    .select("id, name")
    .eq("id", CAANTA_TENANT_ID)
    .maybeSingle();
  if (caanta) {
    tenants.push({ id: caanta.id, name: caanta.name });
  }

  for (const tenant of tenants) {
    const result = await probeBsParity(admin, tenant.id, tenant.name);
    const pass = result.widgetMatchesFinance && result.wrapperMatchesFinance;
    console.log(
      `${pass ? "PASS" : "FAIL"} ${result.tenantName}: Aug widget diff=${result.august.widgetDiff} finance diff=${result.august.financeDiff} (balanced ${result.august.widgetBalanced}/${result.august.financeBalanced}) Dec finance diff=${result.december.financeDiff}`,
    );
    if (!pass) failures += 1;
  }

  console.log(`\n=== Result: ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} ===\n`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
