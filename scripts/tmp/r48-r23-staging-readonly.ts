/**
 * Read-only: R23 attendance_mode schema + R48 October welfare before/after.
 *   npx tsx scripts/tmp/r48-r23-staging-readonly.ts --env-file .env.staging.local
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { resolveDatabaseUrl } from "../resolve-database-url.mjs";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(resolve(filePath), "utf8").split(/\r?\n/)) {
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

function parseEnvFileArg() {
  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return ".env.staging.local";
}

function round2(n: number) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function main() {
  loadEnvForce(parseEnvFileArg());
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) throw new Error("DATABASE_URL missing");
  if (!databaseUrl.includes(STAGING_REF) && !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(STAGING_REF)) {
    console.warn("Warning: URL may not be staging ref", STAGING_REF);
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    console.log("\n=== R23 schema: employees.attendance_mode ===");
    const empCol = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'employees'
        AND column_name = 'attendance_mode'
    `);
    console.log(JSON.stringify(empCol.rows, null, 2));

    console.log("\n=== R23 schema: remote_work_arrangements ===");
    const arrCols = await client.query(`
      SELECT column_name, data_type, is_nullable, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'remote_work_arrangements'
      ORDER BY ordinal_position
    `);
    console.log(JSON.stringify(arrCols.rows, null, 2));

    const arrFks = await client.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table,
        ccu.column_name AS foreign_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'remote_work_arrangements'
        AND tc.constraint_type = 'FOREIGN KEY'
    `);
    console.log("FKs:", JSON.stringify(arrFks.rows, null, 2));

    const policies = await client.query(`
      SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
             pg_get_expr(polwithcheck, polrelid) AS with_check
      FROM pg_policy
      WHERE polrelid = 'public.remote_work_arrangements'::regclass
    `);
    console.log("RLS policies:", JSON.stringify(policies.rows, null, 2));

    console.log("\n=== R48 October open welfare before/after ===");
    const rows = await client.query(`
      WITH open_keys AS (
        SELECT tenant_id, business_unit_id
        FROM month_end_close
        WHERE month = DATE '2026-10-01'
          AND coalesce(lock_status, 'Open') = 'Open'
        UNION
        SELECT DISTINCT pp.tenant_id, pp.business_unit_id
        FROM payroll_processing pp
        WHERE pp.payroll_month = DATE '2026-10-01'
          AND NOT EXISTS (
            SELECT 1 FROM month_end_close mec
            WHERE mec.tenant_id = pp.tenant_id
              AND mec.month = DATE '2026-10-01'
              AND mec.business_unit_id IS NOT DISTINCT FROM pp.business_unit_id
              AND coalesce(mec.lock_status, 'Open') <> 'Open'
          )
      )
      SELECT
        e.staff_id,
        e.full_name,
        coalesce(e.welfare_deduction_rate, 0)::numeric AS rate,
        coalesce(pp.absence_deduction, 0)::numeric AS absence,
        coalesce(pp.gross_pay, 0)::numeric AS gross_pay,
        coalesce(pp.overtime_amount, 0)::numeric AS overtime,
        coalesce(pp.welfare_deduction, 0)::numeric AS welfare_stored,
        coalesce(s.include_overtime_in_welfare, true) AS include_ot
      FROM payroll_processing pp
      JOIN employees e ON e.employee_id = pp.employee_id AND e.tenant_id = pp.tenant_id
      JOIN open_keys ok
        ON ok.tenant_id = pp.tenant_id
       AND ok.business_unit_id IS NOT DISTINCT FROM pp.business_unit_id
      LEFT JOIN LATERAL (
        SELECT include_overtime_in_welfare
        FROM hr_payroll_settings h
        WHERE h.tenant_id = pp.tenant_id
          AND (
            h.business_unit_id IS NOT DISTINCT FROM pp.business_unit_id
            OR h.business_unit_id IS NULL
          )
        ORDER BY (h.business_unit_id IS NOT DISTINCT FROM pp.business_unit_id) DESC
        LIMIT 1
      ) s ON true
      WHERE pp.payroll_month = DATE '2026-10-01'
        AND coalesce(e.welfare_deduction_rate, 0) > 0
        AND coalesce(pp.absence_deduction, 0) > 0
      ORDER BY e.staff_id
    `);

    console.log(
      "staff_id | name | rate% | absence | welfare before | after | delta | stored",
    );
    let changed = 0;
    for (const r of rows.rows) {
      const absence = Number(r.absence);
      const earned = Number(r.gross_pay);
      const preAbsence = round2(earned + absence);
      const ot = Number(r.overtime);
      const rate = Number(r.rate);
      let beforeBase = preAbsence;
      let afterBase = preAbsence;
      if (r.include_ot === false) {
        beforeBase = Math.max(beforeBase - ot, 0);
        afterBase = Math.max(afterBase - ot, 0);
      }
      afterBase = Math.max(afterBase - absence, 0);
      const before = round2((beforeBase * rate) / 100);
      const after = round2((afterBase * rate) / 100);
      if (before === after) continue;
      changed += 1;
      console.log(
        `${r.staff_id} | ${r.full_name} | ${rate} | ${absence.toFixed(2)} | ${before.toFixed(2)} | ${after.toFixed(2)} | ${round2(after - before).toFixed(2)} | ${Number(r.welfare_stored).toFixed(2)}`,
      );
    }
    console.log(`\n${changed} employees with welfare change (${rows.rows.length} with rate>0 and absence>0)`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
