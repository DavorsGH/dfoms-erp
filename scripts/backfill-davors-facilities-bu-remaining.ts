/**
 * Data-only backfill: stamp NULL business_unit_id → Davors Facilities (Davors tenant).
 *
 *   npx tsx scripts/backfill-davors-facilities-bu-remaining.ts --investigate-only
 *   npx tsx scripts/backfill-davors-facilities-bu-remaining.ts --execute --allow-production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { connectPg } from "./lib/pg-connect";

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const SEP_IDX = 8;

const BLANKET_TABLES = [
  "accounts_payable",
  "budgets",
  "capital_contributions",
  "client_invoices",
  "client_invoice_payments",
  "client_receipts",
  "expense_register",
  "fixed_assets",
  "service_contracts",
  "client_quotations",
  "payroll_allowance_lines",
  "corrective_actions",
  "roster_config",
  "tax_ledger_entries",
  "month_end_close",
] as const;

const PRODUCTION_ONLY_TABLES = [
  "accounts_payable_payments",
  "directors_loan_repayments",
  "employees",
  "manual_financial_entries",
] as const;

const STAGING_ONLY_TABLES = ["roster_rotation_metadata"] as const;

type EnvRun = {
  label: "staging" | "production";
  ref: string;
  envFiles: string[];
  supabaseEnvFile: string;
  facilitiesBuId: string;
  extraTables: readonly string[];
};

const ENVS: EnvRun[] = [
  {
    label: "staging",
    ref: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local", ".env.staging.verify.local"],
    supabaseEnvFile: ".env.staging.local",
    facilitiesBuId: "de215200-e92b-48e3-a7ba-977d7289868c",
    extraTables: STAGING_ONLY_TABLES,
  },
  {
    label: "production",
    ref: "tvcurcnmasnocwdxzgvz",
    envFiles: [".env.local.backup", ".env.local"],
    supabaseEnvFile: ".env.local.backup",
    facilitiesBuId: "608f81b5-38be-4756-8a52-8279c859b07c",
    extraTables: PRODUCTION_ONLY_TABLES,
  },
];

const r2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function facilitiesBalanceCheck(
  envFile: string,
  facilitiesBuId: string,
) {
  loadEnv(resolve(envFile));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const page = await fetchBalanceSheetPageData(admin, DAVORS_TENANT_ID, {
    dateRange: null,
    activeBusinessUnitId: facilitiesBuId,
    viewAllBusinessUnits: false,
  });
  if (page.fetchError) throw new Error(page.fetchError);
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
      tenantId: DAVORS_TENANT_ID,
      accountsPayablePayments: page.initialAccountsPayablePayments,
      directorsLoanRepayments: page.initialDirectorsLoanRepayments,
    },
  );
  const check = getBalanceCheckForPeriod(report, SEP_IDX);
  return {
    month: "September 2026",
    facilities_bu_id: facilitiesBuId,
    assets: r2(check.totalAssets),
    liabilities_and_equity: r2(check.totalLiabilitiesAndEquity),
    difference: r2(check.difference),
    balanced: check.isBalanced,
  };
}

async function tableHasColumn(
  client: pg.Client,
  table: string,
  column: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS ok`,
    [table, column],
  );
  return Boolean(rows[0]?.ok);
}

async function countNullBu(
  client: pg.Client,
  table: string,
): Promise<number> {
  const hasTenant = await tableHasColumn(client, table, "tenant_id");
  const hasBu = await tableHasColumn(client, table, "business_unit_id");
  if (!hasBu) return -1;
  const where = hasTenant
    ? `WHERE tenant_id = $1 AND business_unit_id IS NULL`
    : `WHERE business_unit_id IS NULL`;
  const { rows } = await client.query(
    `SELECT count(*)::int AS c FROM public.${table} ${where}`,
    hasTenant ? [DAVORS_TENANT_ID] : [],
  );
  return rows[0]?.c ?? 0;
}

async function backfillTable(
  client: pg.Client,
  table: string,
  facilitiesBuId: string,
): Promise<number> {
  const hasTenant = await tableHasColumn(client, table, "tenant_id");
  const hasBu = await tableHasColumn(client, table, "business_unit_id");
  assert(hasBu, `${table}: missing business_unit_id column`);

  const where = hasTenant
    ? `WHERE tenant_id = $1 AND business_unit_id IS NULL`
    : `WHERE business_unit_id IS NULL`;
  const params = hasTenant
    ? [DAVORS_TENANT_ID, facilitiesBuId]
    : [facilitiesBuId];

  const result = await client.query(
    `UPDATE public.${table}
     SET business_unit_id = $${hasTenant ? 2 : 1}
     ${where}`,
    params,
  );
  return result.rowCount ?? 0;
}

async function runEnv(cfg: EnvRun, execute: boolean) {
  const tables = [
    ...BLANKET_TABLES,
    ...cfg.extraTables,
    "tax_settings",
  ] as string[];

  console.log(`\n========== ${cfg.label.toUpperCase()} (${cfg.ref}) ==========`);

  const beforeBs = await facilitiesBalanceCheck(
    cfg.supabaseEnvFile,
    cfg.facilitiesBuId,
  );
  console.log("BEFORE Facilities BS Sep 2026:", JSON.stringify(beforeBs, null, 2));

  const nullBefore: Record<string, number> = {};
  for (const table of tables) {
    const { client } = await connectPg({
      requiredProjectRef: cfg.ref,
      envFiles: cfg.envFiles,
    });
    try {
      nullBefore[table] = await countNullBu(client, table);
    } finally {
      await client.end();
    }
  }
  console.log("NULL BU counts BEFORE:", JSON.stringify(nullBefore, null, 2));

  const updateCounts: Record<string, number> = {};
  if (execute) {
    const { client } = await connectPg({
      requiredProjectRef: cfg.ref,
      envFiles: cfg.envFiles,
    });
    try {
      const buCheck = await client.query(
        `SELECT id, name FROM business_units
         WHERE tenant_id = $1 AND id = $2 AND is_active = true`,
        [DAVORS_TENANT_ID, cfg.facilitiesBuId],
      );
      assert(
        buCheck.rows.length === 1,
        `${cfg.label}: Facilities BU row missing (${cfg.facilitiesBuId})`,
      );
      console.log(`Facilities BU: ${buCheck.rows[0]!.name}`);

      await client.query("BEGIN");
      try {
        for (const table of tables) {
          updateCounts[table] = await backfillTable(
            client,
            table,
            cfg.facilitiesBuId,
          );
          console.log(`  UPDATE ${table}: ${updateCounts[table]} row(s)`);
        }
        await client.query("COMMIT");
        console.log("COMMIT ok");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    } finally {
      await client.end();
    }
  } else {
    console.log("(investigate-only — no UPDATEs run)");
  }

  const nullAfter: Record<string, number> = {};
  for (const table of tables) {
    const { client } = await connectPg({
      requiredProjectRef: cfg.ref,
      envFiles: cfg.envFiles,
    });
    try {
      nullAfter[table] = await countNullBu(client, table);
    } finally {
      await client.end();
    }
  }
  console.log("NULL BU counts AFTER:", JSON.stringify(nullAfter, null, 2));

  const afterBs = await facilitiesBalanceCheck(
    cfg.supabaseEnvFile,
    cfg.facilitiesBuId,
  );
  console.log("AFTER Facilities BS Sep 2026:", JSON.stringify(afterBs, null, 2));

  const remainingNull = Object.entries(nullAfter).filter(
    ([, c]) => c > 0,
  );
  if (execute && remainingNull.length > 0) {
    throw new Error(
      `${cfg.label}: NULL business_unit_id rows remain: ${JSON.stringify(Object.fromEntries(remainingNull))}`,
    );
  }

  return {
    label: cfg.label,
    before_bs: beforeBs,
    after_bs: afterBs,
    null_before: nullBefore,
    null_after: nullAfter,
    update_counts: updateCounts,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  if (execute && !args.includes("--allow-production")) {
    throw new Error("Pass --allow-production with --execute");
  }

  const results = [];
  for (const cfg of ENVS) {
    results.push(await runEnv(cfg, execute));
  }

  console.log("\n========== SUMMARY ==========");
  console.log(JSON.stringify(results, null, 2));

  if (execute) {
    for (const r of results) {
      assert(
        r.after_bs.balanced,
        `${r.label}: Facilities BS still imbalanced (${r.after_bs.difference})`,
      );
    }
    console.log("\nPASS: All backfills complete; Facilities BS balanced on both envs.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
