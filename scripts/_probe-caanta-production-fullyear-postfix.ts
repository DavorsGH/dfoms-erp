/**
 * READ-ONLY: Caanta production FULL_YEAR probe using local (fixed) code.
 * Does NOT deploy or write to production.
 */
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

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const CA = "12df4ee6-3fd1-459f-8d5c-792b5d5b3821";
const FY = 2026;

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

async function probeTenant(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  tenantName: string,
) {
  const data = await fetchBalanceSheetPageData(admin, tenantId, { dateRange: null });
  if (data.fetchError) {
    return { tenantName, fetchError: data.fetchError };
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
      tenantId,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );
  const fy = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
  let openingEquityFy = 0;
  for (const row of report.rows) {
    if (row.label === "Inventory Opening Balance") {
      openingEquityFy = r2(getBalanceSheetAmountForMonth(row, FULL_YEAR_INDEX));
    }
  }
  return {
    tenantName,
    fullYearDiff: r2(fy.difference),
    balanced: fy.isBalanced,
    assets: r2(fy.totalAssets),
    le: r2(fy.totalLiabilitiesAndEquity),
    openingEquityFy,
  };
}

async function main() {
  loadEnv(".env.local.backup");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(`Refusing non-production URL: ${url}`);
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const lines: string[] = [];
  lines.push("=== PRODUCTION READ-ONLY (fixed local code) ===");
  lines.push(`URL: ${url}`);

  const { data: tenants } = await admin.from("tenants").select("id,name").order("name");
  lines.push("\n--- All tenants FULL_YEAR ---");
  for (const t of tenants ?? []) {
    const r = await probeTenant(admin, t.id, t.name);
    if ("fetchError" in r && r.fetchError) {
      lines.push(`${r.tenantName}: FETCH ${r.fetchError}`);
      continue;
    }
    lines.push(
      `${r.tenantName} | FULL_YEAR diff=${r.fullYearDiff} balanced=${r.balanced} | openingEquityFY=${r.openingEquityFy}`,
    );
  }

  lines.push("\n--- Caanta detail ---");
  const { data: cfg } = await admin
    .from("inventory_balance_config")
    .select("opening_inventory_value,go_live_date")
    .eq("tenant_id", CA)
    .maybeSingle();
  lines.push(`inventory_balance_config: ${JSON.stringify(cfg)}`);

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
    `Caanta FULL_YEAR: diff=${r2(fy.difference)} assets=${r2(fy.totalAssets)} LE=${r2(fy.totalLiabilitiesAndEquity)} balanced=${fy.isBalanced}`,
  );
  lines.push("Caanta FULL_YEAR non-zero lines:");
  for (const row of report.rows) {
    if (row.kind === "section") continue;
    const amt = r2(getBalanceSheetAmountForMonth(row, FULL_YEAR_INDEX));
    if (Math.abs(amt) > 0.001) {
      lines.push(`  ${row.label}: ${amt.toFixed(2)}`);
    }
  }

  const out = lines.join("\n");
  writeFileSync(resolve("scripts/_probe-caanta-production-fullyear-postfix-out.txt"), out);
  console.log(out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
