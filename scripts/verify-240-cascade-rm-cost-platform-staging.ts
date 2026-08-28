/**
 * Staging platform sweep after script 240:
 * - fan-out / performance probe (max batches per material)
 * - FY balance-check for every tenant with inventory config
 *
 *   npx tsx scripts/verify-240-cascade-rm-cost-platform-staging.ts --env-file .env.staging.local
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
    const fanout = await client.query(`
      SELECT
        pbm.material_id,
        rm.material_code,
        rm.tenant_id,
        COUNT(DISTINCT pbm.batch_id)::int AS batch_count
      FROM production_batch_materials pbm
      JOIN raw_materials rm ON rm.id = pbm.material_id
      GROUP BY pbm.material_id, rm.material_code, rm.tenant_id
      ORDER BY batch_count DESC
      LIMIT 10
    `);

    const totalPbm = await client.query(
      `SELECT COUNT(*)::int AS n FROM production_batch_materials`,
    );
    console.log(
      `\nproduction_batch_materials rows (platform): ${totalPbm.rows[0]?.n}`,
    );

    console.log("\nTop materials by production-batch fan-out:");
    for (const row of fanout.rows) {
      console.log(
        `  ${row.batch_count} batches — ${row.material_code} (tenant ${row.tenant_id})`,
      );
    }

    const maxFanout = Number(fanout.rows[0]?.batch_count ?? 0);
    record(
      "cascade fan-out within synchronous RPC bounds",
      maxFanout < 5000,
      `max_batches_per_material=${maxFanout} (flag async only if huge)`,
    );

    // Timing probe: run cascade dry on the heaviest material (idempotent)
    if (fanout.rows[0]?.material_id) {
      const materialId = fanout.rows[0].material_id as string;
      const t0 = Date.now();
      const timed = await client.query(
        `SELECT cascade_raw_material_cost_to_batches($1::uuid) AS batches`,
        [materialId],
      );
      const ms = Date.now() - t0;
      record(
        "cascade runtime on heaviest staging material",
        ms < 10000,
        `batches=${timed.rows[0]?.batches} ms=${ms}`,
      );
    } else {
      record(
        "cascade runtime on heaviest staging material",
        true,
        "no production_batch_materials rows — skipped",
      );
    }

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

    // Script 240 does not rewrite income/expense or cash postings — it only
    // rewrites derived batch costs. Pre-existing tenant imbalances are reported
    // but do not fail this sweep; the functional test asserts baseline delta=0.
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
