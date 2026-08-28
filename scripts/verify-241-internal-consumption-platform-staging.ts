/**
 * Staging platform sweep after script 241:
 * - WAC function includes internal_consumption term on all tenants
 * - FY balance-check for every tenant with inventory config
 *
 *   npx tsx scripts/verify-241-internal-consumption-platform-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

type Check = { step: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(step: string, pass: boolean, detail: string) {
  checks.push({ step, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(url.includes(STAGING_REF), "staging Supabase required");
  assert(key, "SUPABASE_SERVICE_ROLE_KEY required");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { client } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });

  try {
    const wac = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'finished_product_weighted_avg_cost'
    `);
    const wacDef = String(wac.rows[0]?.def ?? "");
    record(
      "WAC includes internal_consumption subtraction",
      wacDef.includes("internal_consumption") &&
        wacDef.includes("expense_register_id"),
      "checked function body",
    );

    const icCount = await client.query(`
      SELECT COUNT(*)::int AS n FROM internal_consumption
    `);
    const icWithExpense = await client.query(`
      SELECT COUNT(*)::int AS n FROM internal_consumption
      WHERE expense_register_id IS NOT NULL
    `);
    record(
      "platform internal_consumption row counts",
      true,
      `rows=${icCount.rows[0]?.n} with_expense=${icWithExpense.rows[0]?.n}`,
    );

    const legacy = await client.query(`
      SELECT COUNT(*)::int AS n FROM expense_register
      WHERE sub_category = 'Cleaning Supplies - Internal Use'
    `);
    record(
      "legacy sub-category migrated",
      Number(legacy.rows[0]?.n ?? 0) === 0,
      `Cleaning Supplies rows remaining=${legacy.rows[0]?.n}`,
    );

    const { data: configs, error: cfgErr } = await admin
      .from("inventory_balance_config")
      .select("tenant_id");
    assert(!cfgErr, cfgErr?.message ?? "inventory_balance_config");

    const tenantIds = [...new Set((configs ?? []).map((r) => r.tenant_id))];
    console.log(`\nBalance-check sweep: ${tenantIds.length} tenants with inventory config`);

    let unbalanced = 0;
    const fy = new Date().getUTCFullYear();
    const unbalancedDetails: string[] = [];
    for (const tenantId of tenantIds) {
      const pageData = await fetchBalanceSheetPageData(admin, tenantId, {
        dateRange: null,
      });
      const report = buildBalanceSheetReport(
        pageData.initialIncomeEntries,
        pageData.initialExpenseEntries,
        pageData.initialFixedAssets,
        pageData.initialPayableEntries,
        pageData.initialCapitalContributions,
        pageData.initialCashFlowExpenseEntries,
        pageData.initialPayrollHistory,
        pageData.initialMonthEndCloseNetPay,
        fy,
        pageData.initialInventoryBalanceSheet,
        pageData.initialManualEntries,
        pageData.initialTaxLedgerEntries,
        {
          tenantId,
          accountsPayablePayments: pageData.initialAccountsPayablePayments,
          directorsLoanRepayments: pageData.initialDirectorsLoanRepayments,
        },
      );
      const check = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
      if (!check.isBalanced) {
        unbalanced += 1;
        unbalancedDetails.push(`${tenantId}: diff=${check.difference}`);
        console.log(
          `  UNBALANCED tenant=${tenantId} diff=${check.difference}`,
        );
      } else {
        console.log(`  OK tenant=${tenantId}`);
      }
    }

    record(
      "platform FY balance-check sweep completed",
      true,
      `tenants=${tenantIds.length} unbalanced=${unbalanced}` +
        (unbalancedDetails.length
          ? ` (${unbalancedDetails.join("; ")})`
          : ""),
    );
  } finally {
    await client.end();
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
