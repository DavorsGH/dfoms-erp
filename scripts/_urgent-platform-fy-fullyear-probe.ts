/** READ-ONLY: all tenants FULL_YEAR (idx 12) + monthly diffs */
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
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

const r2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;
loadEnv(".env.local.backup");
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const CA = "12df4ee6-3fd1-459f-8d5c-792b5d5b3821";
async function main() {
const lines: string[] = [];

const { data: tenants } = await admin.from("tenants").select("id,name").order("name");
lines.push("=== ALL TENANTS: monthly diff (idx 11=Dec) vs FULL_YEAR (idx 12) ===");
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
    2026,
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
    `${t.name} | Dec(idx11) diff=${r2(dec.difference)} bal=${dec.isBalanced} | FULL_YEAR(idx12) diff=${r2(fy.difference)} bal=${fy.isBalanced} assets=${r2(fy.totalAssets)} LE=${r2(fy.totalLiabilitiesAndEquity)}`,
  );
}

lines.push("\n=== CAANTA FULL_YEAR lines ===");
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
    2026,
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    {
      tenantId: CA,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );
  for (let idx = 0; idx <= 12; idx++) {
    const c = getBalanceCheckForPeriod(report, idx === 12 ? FULL_YEAR_INDEX : idx);
    lines.push(`month idx ${idx === 12 ? "FULL_YEAR" : idx}: diff=${r2(c.difference)} assets=${r2(c.totalAssets)} LE=${r2(c.totalLiabilitiesAndEquity)}`);
  }
  for (const row of report.rows) {
    if (row.kind === "section") continue;
    const amt = r2(getBalanceSheetAmountForMonth(row, FULL_YEAR_INDEX));
    if (Math.abs(amt) > 0.001) {
      lines.push(`  ${row.kind} | ${row.label} | ${amt.toFixed(2)}`);
    }
  }
}

const { data: cfg } = await admin
  .from("inventory_balance_config")
  .select("*")
  .eq("tenant_id", CA)
  .maybeSingle();
lines.push("\ninventory_balance_config: " + JSON.stringify(cfg));

const { data: rm } = await admin
  .from("raw_material_purchases")
  .select("purchase_date,total_cost,payment_method")
  .eq("tenant_id", CA)
  .gte("purchase_date", "2026-08-01")
  .order("purchase_date");
lines.push(
  "raw_material_purchases Aug+: " +
    JSON.stringify(rm) +
    " total=" +
    r2((rm ?? []).reduce((s, p) => s + Number(p.total_cost || 0), 0)),
);

const out = lines.join("\n");
writeFileSync(resolve("scripts/_urgent-platform-fy-fullyear-out.txt"), out);
console.log(out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
