/** READ-ONLY: staging tenants FULL_YEAR (idx 12) + monthly diffs */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";

function loadEnv(p: string) {
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
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

const r2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;
const CA = "12df4ee6-3fd1-459f-8d5c-792b5d5b3821";
const FY = 2026;

async function main() {
  loadEnv(".env.staging.local");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const lines: string[] = [];
  lines.push(`Staging URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  lines.push(`=== ALL STAGING TENANTS FY${FY}: Dec vs FULL_YEAR ===`);

  const { data: tenants } = await admin.from("tenants").select("id,name").order("name");
  for (const t of tenants ?? []) {
    const data = await fetchBalanceSheetPageData(admin, t.id, { dateRange: null });
    if (data.fetchError) {
      lines.push(`${t.name}: FETCH ${data.fetchError}`);
      continue;
    }
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
        tenantId: t.id,
        accountsPayablePayments: data.initialAccountsPayablePayments,
        directorsLoanRepayments: data.initialDirectorsLoanRepayments,
      },
    );
    const dec = getBalanceCheckForPeriod(report, 11);
    const fy = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
    lines.push(
      `${t.name} | Dec diff=${r2(dec.difference)} bal=${dec.isBalanced} | FULL_YEAR diff=${r2(fy.difference)} bal=${fy.isBalanced}`,
    );
  }

  lines.push("\n=== CAANTA STAGING: inventory_balance_config ===");
  const { data: cfg } = await admin
    .from("inventory_balance_config")
    .select("*")
    .eq("tenant_id", CA)
    .maybeSingle();
  lines.push(JSON.stringify(cfg));

  lines.push("\n=== CAANTA STAGING: FULL_YEAR non-zero lines ===");
  {
    const data = await fetchBalanceSheetPageData(admin, CA, { dateRange: null });
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
        tenantId: CA,
        accountsPayablePayments: data.initialAccountsPayablePayments,
        directorsLoanRepayments: data.initialDirectorsLoanRepayments,
      },
    );
    const fy = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
    lines.push(
      `FULL_YEAR check: diff=${r2(fy.difference)} assets=${r2(fy.totalAssets)} LE=${r2(fy.totalLiabilitiesAndEquity)} balanced=${fy.isBalanced}`,
    );
    for (const row of report.rows) {
      if (row.kind === "section") continue;
      const amt = r2(getBalanceSheetAmountForMonth(row, FULL_YEAR_INDEX));
      if (Math.abs(amt) > 0.001) {
        lines.push(`  ${row.kind} | ${row.label} | ${amt.toFixed(2)}`);
      }
    }
  }

  const out = lines.join("\n");
  writeFileSync(resolve("scripts/_probe-fy-fullyear-staging-out.txt"), out);
  console.log(out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
