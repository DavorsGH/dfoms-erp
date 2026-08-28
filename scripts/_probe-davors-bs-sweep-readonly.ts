/**
 * READ-ONLY: staging Davors BS month sweep
 */
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const r2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

async function main() {
  const envFile = process.argv.includes("--production")
    ? ".env.local.backup"
    : ".env.staging.local";
  loadEnvForce(resolve(process.cwd(), envFile));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  console.log("env:", envFile, process.env.NEXT_PUBLIC_SUPABASE_URL);

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

  for (let i = 0; i < 12; i += 1) {
    const c = getBalanceCheckForPeriod(report, i);
    if (Math.abs(r2(c.difference)) >= 0.01) {
      console.log(`Month ${i + 1}: diff=${r2(c.difference)} assets=${r2(c.totalAssets)} LE=${r2(c.totalLiabilitiesAndEquity)}`);
    }
  }

  const aug = 7;
  const check = getBalanceCheckForPeriod(report, aug);
  console.log("\nAug detail diff=", r2(check.difference));
  for (const row of report.rows) {
    if (row.kind === "section" || row.kind === "spacer") continue;
    const amt = r2(getBalanceSheetAmountForMonth(row, aug));
    if (Math.abs(amt) < 0.005) continue;
    console.log(`  ${row.label}: ${amt.toFixed(2)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
