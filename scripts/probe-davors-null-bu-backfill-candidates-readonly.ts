/**
 * Read-only: NULL business_unit_id audit for Davors tenant backfill candidates.
 * Compares staging vs production — no UPDATEs.
 *
 *   npx tsx scripts/probe-davors-null-bu-backfill-candidates-readonly.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

/** Tables from approved backfill scope (remaining real-business-data candidates). */
const CANDIDATE_TABLES = [
  "accounts_payable",
  "accounts_payable_payments",
  "budgets",
  "capital_contributions",
  "client_invoices",
  "client_invoice_payments",
  "client_receipts",
  "directors_loan_repayments",
  "expense_register",
  "fixed_assets",
  "manual_financial_entries",
  "service_contracts",
  "client_quotations",
  "employees",
  "payroll_allowance_lines",
  "payroll_link",
  "corrective_actions",
  "internal_consumption",
  "roster_config",
  "roster_rotation_metadata",
  "sales_activities",
  "tax_ledger_entries",
  "tax_settings",
  "month_end_close",
  "inventory_balance_config",
] as const;

type EnvConfig = { label: string; envFile: string; ref: string };

const ENVS: EnvConfig[] = [
  {
    label: "staging",
    envFile: ".env.staging.local",
    ref: "wieflwbfdmjtsdnwbfii",
  },
  {
    label: "production",
    envFile: ".env.local.backup",
    ref: "tvcurcnmasnocwdxzgvz",
  },
];

type TableAudit = {
  table: string;
  status:
    | "ok"
    | "table_missing"
    | "column_missing"
    | "no_tenant_rows"
    | "no_bu_column";
  total_rows: number;
  null_bu_rows: number;
  non_null_bu_rows: number;
  bu_breakdown: Array<{ business_unit_id: string | null; count: number }>;
  flag: string | null;
};

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

async function auditTable(
  client: pg.Client,
  table: string,
): Promise<TableAudit> {
  const tableExists = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS ok`,
    [table],
  );
  if (!tableExists.rows[0]?.ok) {
    return {
      table,
      status: "table_missing",
      total_rows: 0,
      null_bu_rows: 0,
      non_null_bu_rows: 0,
      bu_breakdown: [],
      flag: "TABLE_MISSING",
    };
  }

  const hasTenant = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'tenant_id'
     ) AS ok`,
    [table],
  );
  const hasBu = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'business_unit_id'
     ) AS ok`,
    [table],
  );

  if (!hasBu.rows[0]?.ok) {
    return {
      table,
      status: "column_missing",
      total_rows: 0,
      null_bu_rows: 0,
      non_null_bu_rows: 0,
      bu_breakdown: [],
      flag: "NO business_unit_id COLUMN",
    };
  }

  const tenantFilter = hasTenant.rows[0]?.ok
    ? `WHERE tenant_id = $1`
    : `WHERE true`;

  const totalQ = await client.query(
    `SELECT count(*)::int AS c FROM public.${table} ${tenantFilter}`,
    hasTenant.rows[0]?.ok ? [DAVORS_TENANT_ID] : [],
  );
  const total = totalQ.rows[0]?.c ?? 0;

  if (total === 0) {
    return {
      table,
      status: "no_tenant_rows",
      total_rows: 0,
      null_bu_rows: 0,
      non_null_bu_rows: 0,
      bu_breakdown: [],
      flag: null,
    };
  }

  const nullQ = await client.query(
    `SELECT count(*)::int AS c FROM public.${table}
     ${tenantFilter} AND business_unit_id IS NULL`,
    hasTenant.rows[0]?.ok ? [DAVORS_TENANT_ID] : [],
  );
  const nullBu = nullQ.rows[0]?.c ?? 0;
  const nonNullBu = total - nullBu;

  const breakdownQ = await client.query(
    `SELECT business_unit_id::text, count(*)::int AS c
     FROM public.${table}
     ${tenantFilter}
     GROUP BY business_unit_id
     ORDER BY c DESC, business_unit_id NULLS FIRST`,
    hasTenant.rows[0]?.ok ? [DAVORS_TENANT_ID] : [],
  );

  const bu_breakdown = breakdownQ.rows.map((r) => ({
    business_unit_id: r.business_unit_id as string | null,
    count: r.c as number,
  }));

  let flag: string | null = null;
  if (nullBu > 0 && nonNullBu > 0) {
    flag = "MIXED — manual review before blanket backfill";
  } else if (nullBu === total && total > 0) {
    flag = "ALL_NULL — safe for blanket Facilities backfill";
  } else if (nullBu === 0 && total > 0) {
    flag = "FULLY_TAGGED — no NULL rows";
  }

  return {
    table,
    status: "ok",
    total_rows: total,
    null_bu_rows: nullBu,
    non_null_bu_rows: nonNullBu,
    bu_breakdown,
    flag,
  };
}

async function auditEnv(cfg: EnvConfig): Promise<TableAudit[]> {
  loadEnv(resolve(cfg.envFile));
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const results: TableAudit[] = [];
    for (const table of CANDIDATE_TABLES) {
      results.push(await auditTable(client, table));
    }
    return results;
  } finally {
    await client.end();
  }
}

async function main() {
  const byEnv: Record<string, TableAudit[]> = {};
  for (const cfg of ENVS) {
    console.error(`Auditing ${cfg.label} (${cfg.ref})…`);
    byEnv[cfg.label] = await auditEnv(cfg);
  }

  console.log(
    JSON.stringify(
      {
        tenant_id: DAVORS_TENANT_ID,
        candidate_table_count: CANDIDATE_TABLES.length,
        environments: ENVS.map((e) => ({ label: e.label, ref: e.ref })),
        staging: byEnv.staging,
        production: byEnv.production,
        summary: {
          staging: {
            tables_with_null_bu: byEnv.staging.filter((r) => r.null_bu_rows > 0)
              .length,
            total_null_bu_rows: byEnv.staging.reduce(
              (s, r) => s + r.null_bu_rows,
              0,
            ),
            mixed_tables: byEnv.staging
              .filter((r) => r.flag?.startsWith("MIXED"))
              .map((r) => r.table),
            flags: byEnv.staging.filter((r) => r.flag).map((r) => ({
              table: r.table,
              flag: r.flag,
            })),
          },
          production: {
            tables_with_null_bu: byEnv.production.filter(
              (r) => r.null_bu_rows > 0,
            ).length,
            total_null_bu_rows: byEnv.production.reduce(
              (s, r) => s + r.null_bu_rows,
              0,
            ),
            mixed_tables: byEnv.production
              .filter((r) => r.flag?.startsWith("MIXED"))
              .map((r) => r.table),
            flags: byEnv.production.filter((r) => r.flag).map((r) => ({
              table: r.table,
              flag: r.flag,
            })),
          },
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
