/**
 * READ-ONLY: Pin staging Davors Aug 2026 BS gap (44.90) to specific transactions.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  isActiveIncomeForReporting,
} from "../app/dashboard/finance/income-register-utils";
import { getTaxExclusiveRevenueAmount } from "../app/dashboard/finance/profit-loss-utils";
import { buildMonthlyCashComponents } from "../app/dashboard/finance/cash-movement-utils";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const AUG = 7;
const r2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    console.log(s);
  };

  const page = await fetchBalanceSheetPageData(admin, DAVORS, { dateRange: null });
  const report = buildBalanceSheetReport(
    page.initialIncomeEntries,
    page.initialExpenseEntries,
    page.initialFixedAssets,
    page.initialPayableEntries,
    page.initialCapitalContributions,
    page.initialCashFlowExpenseEntries,
    page.initialPayrollHistory,
    page.initialMonthEndCloseNetPay,
    FY,
    page.initialInventoryBalanceSheet,
    page.initialManualEntries,
    page.initialTaxLedgerEntries,
    {
      tenantId: DAVORS,
      accountsPayablePayments: page.initialAccountsPayablePayments,
      directorsLoanRepayments: page.initialDirectorsLoanRepayments,
    },
  );

  const check = getBalanceCheckForPeriod(report, AUG);
  log(`=== Staging Davors Aug 2026 BS check ===`);
  log(`diff=${r2(check.difference)} assets=${r2(check.totalAssets)} LE=${r2(check.totalLiabilitiesAndEquity)}`);

  log("\n--- Pattern A: cash received vs P&L revenue (active Aug income) ---");
  let cashRevenueGapSum = 0;
  for (const entry of page.initialIncomeEntries) {
    if (!entry.date?.startsWith("2026-08")) continue;
    if (!isActiveIncomeForReporting(entry)) continue;
    const received = r2(Number(entry.amount_received) || 0);
    const revenue = r2(getTaxExclusiveRevenueAmount(entry));
    const gap = r2(received - revenue);
    if (Math.abs(gap) < 0.005) continue;
    cashRevenueGapSum = r2(cashRevenueGapSum + gap);
    log(
      `  ${entry.invoice_no}: received=${received} revenue=${revenue} gap=${gap} status=${entry.payment_status} sale=${entry.sale_status ?? "n/a"}`,
    );
  }
  log(`  Sum cash-vs-revenue gaps (Aug active): ${cashRevenueGapSum}`);

  log("\n--- Pattern B: voided / inactive income still with COGS ---");
  const augCogs = page.initialExpenseEntries.filter(
    (e) =>
      e.date?.startsWith("2026-08") &&
      (e.expense_category ?? "").toLowerCase().includes("cost of goods"),
  );
  const incomeById = new Map(page.initialIncomeEntries.map((e) => [e.id, e]));
  let orphanCogsSum = 0;
  for (const cogs of augCogs) {
    const match = /Linked to income_register ([0-9a-f-]+)/i.exec(cogs.notes ?? "");
    const incomeId = match?.[1];
    const linked = incomeId ? incomeById.get(incomeId) : undefined;
    const cogsAmt = r2(Number(cogs.amount) || 0);
    if (cogsAmt <= 0) continue;

    const active = linked ? isActiveIncomeForReporting(linked) : false;
    const revenue = linked && active ? r2(getTaxExclusiveRevenueAmount(linked)) : 0;
    if (!linked || !active) {
      orphanCogsSum = r2(orphanCogsSum + cogsAmt);
      log(
        `  ${cogs.receipt_no}: cogs=${cogsAmt} linked=${linked?.invoice_no ?? "MISSING"} active=${active}`,
      );
    } else if (Math.abs(cogsAmt - revenue) > 0.01 && revenue > 0) {
      log(
        `  ${cogs.receipt_no}: cogs=${cogsAmt} revenue=${revenue} invoice=${linked.invoice_no}`,
      );
    }
  }
  log(`  Sum orphan COGS (no active revenue): ${orphanCogsSum}`);

  log("\n--- Pattern C: DF-POS-0009 / offline conflict cluster ---");
  const pos9 = page.initialIncomeEntries.find((e) => e.invoice_no === "DF-POS-0009");
  const pos10 = page.initialIncomeEntries.find((e) => e.invoice_no === "DF-POS-0010");
  const inc2 = page.initialIncomeEntries.find((e) => e.invoice_no === "DF-INC-0002");
  for (const row of [pos9, pos10, inc2]) {
    if (!row) {
      log("  (missing row)");
      continue;
    }
    log(
      `  ${row.invoice_no}: amount=${row.amount} received=${row.amount_received} sale=${row.sale_status} active=${isActiveIncomeForReporting(row)} cogs_id=${row.cogs_expense_id ?? "none"}`,
    );
  }
  const cogs9 = augCogs.find((e) => e.receipt_no === "COGS-DF-POS-0009");
  const cogs10 = augCogs.find((e) => e.receipt_no === "COGS-DF-POS-0010");
  log(`  COGS-DF-POS-0009 amount=${cogs9?.amount ?? "n/a"}`);
  log(`  COGS-DF-POS-0010 amount=${cogs10?.amount ?? "n/a"}`);

  log("\n--- Pattern D: voided sales with non-zero received ---");
  let voidedCashLeak = 0;
  for (const entry of page.initialIncomeEntries) {
    if (!entry.date?.startsWith("2026-08")) continue;
    if (isActiveIncomeForReporting(entry)) continue;
    const received = r2(Number(entry.amount_received) || 0);
    if (received <= 0) continue;
    voidedCashLeak = r2(voidedCashLeak + received);
    log(
      `  ${entry.invoice_no}: voided/inactive but received=${received} sale=${entry.sale_status} pay=${entry.payment_status}`,
    );
  }
  log(`  (voided rows excluded from cash engine — leak if >0 would NOT hit BS cash)`);

  log("\n--- Pattern E: inventory vs COGS reconciliation Aug ---");
  const invJul = r2(getBalanceSheetAmountForMonth(report.rows.find((r) => r.key === "inventory")!, AUG - 1));
  const invAug = r2(getBalanceSheetAmountForMonth(report.rows.find((r) => r.key === "inventory")!, AUG));
  const rmPurchAug = page.initialInventoryBalanceSheet?.cashPurchases?.filter((p) =>
    p.purchase_date?.startsWith("2026-08"),
  );
  const rmTotal = r2((rmPurchAug ?? []).reduce((s, p) => s + (Number(p.total_cost) || 0), 0));
  const cogsTotal = r2(augCogs.reduce((s, e) => s + (Number(e.amount) || 0), 0));
  log(`  inventory Jul=${invJul} Aug=${invAug} delta=${r2(invAug - invJul)}`);
  log(`  raw_material cash purchases Aug=${rmTotal}`);
  log(`  COGS expense_register Aug=${cogsTotal}`);
  log(`  implied inventory build=${r2(rmTotal - cogsTotal)} vs actual delta=${r2(invAug - invJul)}`);
  log(`  inventory COGS mismatch=${r2(invAug - invJul - (rmTotal - cogsTotal))}`);

  log("\n--- Pattern F: manual directors loan / loan proceeds Aug ---");
  for (const m of page.initialManualEntries) {
    if (!m.period_month?.startsWith("2026-08")) continue;
    log(
      `  ${m.period_month}: directors_loan=${m.directors_loan} loan_proceeds=${m.loan_proceeds} loan_repayments=${m.loan_repayments} opening_cash=${m.opening_cash_balance}`,
    );
  }

  log("\n--- Attribution summary ---");
  const attributed = r2(cashRevenueGapSum + orphanCogsSum);
  log(`  cash-vs-revenue gap sum: ${cashRevenueGapSum}`);
  log(`  orphan COGS sum: ${orphanCogsSum}`);
  log(`  combined attributed: ${attributed}`);
  log(`  actual BS diff: ${r2(check.difference)}`);
  log(`  residual: ${r2(check.difference - attributed)}`);

  const cashComponents = buildMonthlyCashComponents(
    {
      tenantId: DAVORS,
      incomeEntries: page.initialIncomeEntries,
      expenseEntries: page.initialCashFlowExpenseEntries,
      capitalContributions: page.initialCapitalContributions,
      fixedAssets: page.initialFixedAssets,
      rawMaterialCashPurchases: page.initialInventoryBalanceSheet?.cashPurchases ?? [],
      productCashPurchases: page.initialInventoryBalanceSheet?.productCashPurchases ?? [],
      inventoryConfig: page.initialInventoryBalanceSheet?.config ?? null,
      manualEntries: page.initialManualEntries,
      accountsPayableSettlements: page.initialPayableEntries,
      accountsPayablePayments: page.initialAccountsPayablePayments,
      directorsLoanRepayments: page.initialDirectorsLoanRepayments,
    },
    FY,
  );
  log(`\nAug cash component incomeReceived=${r2(cashComponents.incomeReceived[AUG])}`);

  const out = resolve(process.cwd(), "scripts/_probe-staging-davors-4490-attribution-out.txt");
  writeFileSync(out, lines.join("\n"), "utf8");
  log(`\nWrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
