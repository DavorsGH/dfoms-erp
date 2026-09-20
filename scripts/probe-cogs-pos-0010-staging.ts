/**
 * Read-only: confirm COGS-DF-POS-0010 is the +8.00 August BS gap.
 *   npx tsx scripts/probe-cogs-pos-0010-staging.ts
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

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const AUG_IDX = 7;
const COGS_RECEIPT = "COGS-DF-POS-0010";

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

function buildReport(data, expenses, taxEntries) {
  return buildBalanceSheetReport(
    data.initialIncomeEntries,
    expenses,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    data.initialCashFlowExpenseEntries.filter(
      (e) => !expenses.some((x) => x.receipt_no === e.receipt_no && x !== e),
    ),
    data.initialPayrollHistory,
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
  const expenses = data.initialExpenseEntries;
  const cogs = expenses.find((e) => e.receipt_no === COGS_RECEIPT);

  const reportWith = buildBalanceSheetReport(
    data.initialIncomeEntries,
    expenses,
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

  const expensesNoCogs = expenses.filter((e) => e.receipt_no !== COGS_RECEIPT);
  const cashFlowNoCogs = data.initialCashFlowExpenseEntries.filter(
    (e) => e.receipt_no !== COGS_RECEIPT,
  );
  const reportNoCogs = buildBalanceSheetReport(
    data.initialIncomeEntries,
    expensesNoCogs,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    cashFlowNoCogs,
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

  const withCheck = getBalanceCheckForPeriod(reportWith, AUG_IDX);
  const noCheck = getBalanceCheckForPeriod(reportNoCogs, AUG_IDX);

  console.log("=== COGS expense ===");
  console.log(cogs);

  const [{ data: sale }, { data: invConfig }] = await Promise.all([
    admin
      .from("product_sales")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("receipt_no", "DF-POS-0010")
      .maybeSingle(),
    admin
      .from("inventory_balance_config")
      .select("*")
      .eq("tenant_id", DAVORS)
      .maybeSingle(),
  ]);

  console.log("\n=== Product sale DF-POS-0010 ===");
  console.log(sale);

  console.log("\n=== Inventory config ===");
  console.log(invConfig);

  console.log("\n=== August BS counterfactual ===");
  console.log({
    withCogs: r2(withCheck.difference),
    withoutCogs: r2(noCheck.difference),
    cogsAloneAdds: r2(withCheck.difference - noCheck.difference),
  });

  const rowKeys = [
    "cash",
    "accounts-receivable",
    "fixed-assets-net",
    "inventory",
    "retained-earnings",
    "directors-loan",
    "net-vat-payable",
  ];
  console.log("\n=== Line deltas (with vs without COGS-DF-POS-0010) ===");
  for (const key of rowKeys) {
    const withRow = reportWith.rows.find((r) => r.key === key);
    const noRow = reportNoCogs.rows.find((r) => r.key === key);
    const w = r2(withRow?.amounts[AUG_IDX] ?? 0);
    const n = r2(noRow?.amounts[AUG_IDX] ?? 0);
    const d = r2(w - n);
    if (Math.abs(d) > 0.001) {
      console.log(`  ${withRow?.label}: ${n} → ${w} (Δ ${d})`);
    }
  }

  console.log("\n=== Jul→Aug deltas (with full data) ===");
  const julIdx = 6;
  for (const key of rowKeys) {
    const row = reportWith.rows.find((r) => r.key === key);
    const d = r2((row?.amounts[AUG_IDX] ?? 0) - (row?.amounts[julIdx] ?? 0));
    if (Math.abs(d) > 0.001) {
      console.log(`  ${row?.label}: Δ ${d}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
