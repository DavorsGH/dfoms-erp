/**
 * Read-only probe: August 2026 reopen error on staging.
 * npx tsx scripts/probe-august-2026-reopen-error-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const PAYROLL_MONTH = "2026-08-01";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? "";

  if (!url.includes(STAGING_REF)) {
    throw new Error(`Refusing non-staging URL: ${url}`);
  }
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("\n=== Function signatures on staging ===");
  if (dbUrl) {
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    const { rows } = await client.query(`
      SELECT p.proname,
             pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          '_delete_payroll_lock_finance',
          '_payroll_delete_open_statutory_tax_ledger',
          '_payroll_delete_open_welfare_fund_accrual',
          '_payroll_open_period_core',
          'reopen_payroll_period'
        )
      ORDER BY p.proname, args
    `);
    console.log(JSON.stringify(rows, null, 2));

    const { rows: srcRows } = await client.query(`
      SELECT p.proname,
             position('_delete_payroll_lock_finance(' in pg_get_functiondef(p.oid)) > 0 AS calls_delete_finance
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = '_payroll_open_period_core'
    `);
    if (srcRows[0]) {
      const { rows: defRows } = await client.query(`
        SELECT pg_get_functiondef(p.oid) AS def
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = '_payroll_open_period_core'
        LIMIT 1
      `);
      const def = defRows[0]?.def ?? "";
      const match = def.match(
        /_delete_payroll_lock_finance\([\s\S]*?\);/,
      );
      console.log("\n_payroll_open_period_core delete call snippet:");
      console.log(match ? match[0] : "(not found)");
    }

    await client.end();
  } else {
    console.log("(no SUPABASE_DB_URL — skipping pg_proc check)");
  }

  console.log("\n=== August 2026 month_end_close rows (all BUs) ===");
  const { data: mecRows, error: mecErr } = await admin
    .from("month_end_close")
    .select("*")
    .eq("tenant_id", DAVORS)
    .eq("month", PAYROLL_MONTH);
  if (mecErr) throw mecErr;
  console.log(JSON.stringify(mecRows, null, 2));

  const [{ count: histCount }, { count: procCount }] = await Promise.all([
    admin
      .from("payroll_history")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", PAYROLL_MONTH),
    admin
      .from("payroll_processing")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", PAYROLL_MONTH),
  ]);
  console.log("\n=== payroll row counts ===");
  console.log({ histCount, procCount });

  const { data: employees, error: empErr } = await admin
    .from("employees")
    .select("employee_id, business_unit_id")
    .eq("tenant_id", DAVORS);
  if (empErr) throw empErr;

  const nullBuEmployeeIds = (employees ?? [])
    .filter((row) => row.business_unit_id == null)
    .map((row) => row.employee_id as string);

  console.log("\n=== employees by BU ===");
  const buCounts = new Map<string | null, number>();
  for (const row of employees ?? []) {
    const bu = (row.business_unit_id as string | null) ?? null;
    buCounts.set(bu, (buCounts.get(bu) ?? 0) + 1);
  }
  console.log(Object.fromEntries(buCounts));

  const mecBu =
    (mecRows?.[0]?.business_unit_id as string | null | undefined) ?? null;
  console.log("\n=== MEC business_unit_id for August ===", mecBu);

  const scopedForMecBu = (employees ?? [])
    .filter((row) => row.business_unit_id === mecBu)
    .map((row) => row.employee_id as string);
  console.log("employees in MEC BU:", scopedForMecBu.length);

  async function probeReopen(label: string, businessUnitId: string | null, employeeIds: string[]) {
    console.log(`\n=== reopen_payroll_period [${label}] (rolled back) ===`);
    if (!dbUrl) {
      console.log("(skipped — no db url)");
      return;
    }
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT public.reopen_payroll_period($1::uuid, $2::uuid, $3::text[], $4::date, $5::int, $6::int) AS result`,
        [DAVORS, businessUnitId, employeeIds, PAYROLL_MONTH, 2026, 8],
      );
      console.log("RPC would succeed:", JSON.stringify(rows[0]?.result, null, 2));
    } catch (pgErr: any) {
      console.log("POSTGRES ERROR:", pgErr.message);
      if (pgErr.detail) console.log("DETAIL:", pgErr.detail);
      if (pgErr.hint) console.log("HINT:", pgErr.hint);
      if (pgErr.where) console.log("WHERE:", pgErr.where);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  }

  await probeReopen("null BU + null-BU employees", null, nullBuEmployeeIds);
  await probeReopen("MEC BU + MEC-BU employees", mecBu, scopedForMecBu);

  const TECH_BU = "d251c562-d522-43ec-8d9c-d1d00d4105b0";
  const techEmployeeIds = (employees ?? [])
    .filter((row) => row.business_unit_id === TECH_BU)
    .map((row) => row.employee_id as string);
  await probeReopen("Tech BU + Tech employees", TECH_BU, techEmployeeIds);

  const { data: histRows } = await admin
    .from("payroll_history")
    .select("employee_id")
    .eq("tenant_id", DAVORS)
    .eq("payroll_month", PAYROLL_MONTH);
  const histEmployeeIds = (histRows ?? []).map((r) => r.employee_id as string);
  const { data: histEmps } = await admin
    .from("employees")
    .select("employee_id, business_unit_id")
    .eq("tenant_id", DAVORS)
    .in("employee_id", histEmployeeIds);
  const histByBu: Record<string, number> = {};
  for (const row of histEmps ?? []) {
    const key = (row.business_unit_id as string | null) ?? "NULL";
    histByBu[key] = (histByBu[key] ?? 0) + 1;
  }
  console.log("\n=== August payroll_history employees by BU ===");
  console.log(histByBu);
  console.log("null-BU employee count (tenant-wide):", nullBuEmployeeIds.length);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
