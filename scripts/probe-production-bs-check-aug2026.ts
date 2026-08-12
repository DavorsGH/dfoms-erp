/**
 * Read-only: August FY2026 Balance Sheet check for named production tenants.
 * Uses the same fetch + buildBalanceSheetReport + getBalanceCheckForPeriod path
 * as the Dashboard BS Check widget (via buildDashboardBalanceSheetCheck).
 *
 * Usage:
 *   npx tsx scripts/probe-production-bs-check-aug2026.ts
 *   npx tsx scripts/probe-production-bs-check-aug2026.ts --env-file .env.local.backup
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { buildDashboardBalanceSheetCheck } from "../app/dashboard/dashboard-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const FY = 2026;
const AUGUST_INDEX = 7;

const TARGET_TENANTS = [
  {
    tenantId: "da8b968e-dd42-48d5-93c5-a3147ff5de72",
    tenantName: "Nextronics",
  },
  {
    tenantId: "dc7c89d4-df61-4ea5-b2ef-65ab6221c06e",
    tenantName: "Mimshack-Glo-Ltd",
  },
] as const;

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

function parseArgs() {
  let envFile = ".env.local.backup";
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--env-file=")) envFile = arg.slice("--env-file=".length);
  }
  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) envFile = process.argv[idx + 1]!;
  return { envFile };
}

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function checkTenant(admin: SupabaseClient, tenantId: string, tenantName: string) {
  const data = await fetchBalanceSheetPageData(admin, tenantId);
  if (data.fetchError) {
    throw new Error(`${tenantName}: ${data.fetchError}`);
  }

  const reportOptions = {
    tenantId,
    accountsPayablePayments: data.initialAccountsPayablePayments,
    directorsLoanRepayments: data.initialDirectorsLoanRepayments,
  };

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
    reportOptions,
  );

  const check = getBalanceCheckForPeriod(report, AUGUST_INDEX);
  const widgetCheck = buildDashboardBalanceSheetCheck(report, AUGUST_INDEX);

  return {
    tenantName,
    tenantId,
    totalAssets: r2(check.totalAssets),
    totalLiabilitiesAndEquity: r2(check.totalLiabilitiesAndEquity),
    difference: r2(check.difference),
    isBalanced: check.isBalanced,
    widgetDifference: r2(widgetCheck.difference),
    widgetParityOk:
      widgetCheck.difference === check.difference &&
      widgetCheck.isBalanced === check.isBalanced,
  };
}

async function main() {
  const { envFile } = parseArgs();
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    throw new Error(`Missing Supabase credentials in ${envFile}`);
  }
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(
      `Refusing: expected production project ${PRODUCTION_REF}, got ${url}`,
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient;

  console.log("Balance Sheet check — August 2026 (read-only)");
  console.log(`Environment: ${url}`);
  console.log(`Fiscal year: ${FY}, month index: ${AUGUST_INDEX} (Aug)\n`);

  for (const tenant of TARGET_TENANTS) {
    const result = await checkTenant(admin, tenant.tenantId, tenant.tenantName);
    console.log(`--- ${result.tenantName} (${result.tenantId}) ---`);
    console.log(`Total Assets:                 GHS ${result.totalAssets.toFixed(2)}`);
    console.log(
      `Total Liabilities + Equity:   GHS ${result.totalLiabilitiesAndEquity.toFixed(2)}`,
    );
    console.log(
      `Difference (Assets − L+E):    GHS ${result.difference.toFixed(2)} ${result.isBalanced ? "(balanced)" : "(OUT OF BALANCE)"}`,
    );
    console.log(
      `Dashboard widget parity:      ${result.widgetParityOk ? "OK" : `MISMATCH (widget diff ${result.widgetDifference.toFixed(2)})`}`,
    );
    console.log("");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
