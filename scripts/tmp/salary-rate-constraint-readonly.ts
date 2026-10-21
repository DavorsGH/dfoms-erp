// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { resolveDatabaseUrl } from "../resolve-database-url.mjs";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(resolve(filePath), "utf8").split(/\r?\n/)) {
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

async function inspect(label: string, envFile: string) {
  loadEnvForce(envFile);
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  const client = new pg.Client({
    connectionString: resolveDatabaseUrl()!,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const ver = await client.query("SELECT version()");
  const pgVer = await client.query("SHOW server_version_num");

  const constraint = await client.query(`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'salary_rate_config'
      AND c.conname = 'salary_rate_config_position_employment_type_shift_effective_key'
  `);

  const indexes = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'salary_rate_config'
  `);

  const cols = await client.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'salary_rate_config'
    ORDER BY ordinal_position
  `);

  const dupGroups = await client.query(`
    SELECT position, employment_type, shift, effective_date, count(*)::int AS c,
           array_agg(tenant_id::text) AS tenants,
           array_agg(coalesce(business_unit_id::text, 'null')) AS bus
    FROM public.salary_rate_config
    GROUP BY position, employment_type, shift, effective_date
    HAVING count(*) > 1
    ORDER BY c DESC
    LIMIT 20
  `);

  const crossTenantDup = await client.query(`
    SELECT count(*)::int AS groups FROM (
      SELECT position, employment_type, shift, effective_date
      FROM public.salary_rate_config
      GROUP BY position, employment_type, shift, effective_date
      HAVING count(DISTINCT tenant_id) > 1
    ) s
  `);

  const policies = await client.query(`
    SELECT policyname, cmd, qual, with_check FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'salary_rate_config'
    ORDER BY policyname
  `);

  const hrUniques = await client.query(`
    SELECT c.conrelid::regclass::text AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.contype = 'u'
      AND c.conrelid::regclass::text IN (
        'compensation_policy', 'allowance_types', 'hr_payroll_settings',
        'leave_entitlement_policy', 'salary_rate_config'
      )
    ORDER BY 1, 2
  `);

  console.log(`\n========== ${label} (${ref}) ==========`);
  console.log("Postgres:", ver.rows[0].version.split("\n")[0]);
  console.log("server_version_num:", pgVer.rows[0].server_version_num);

  console.log("\nColumns:");
  for (const r of cols.rows) console.log(`  ${r.column_name} (${r.data_type})`);

  console.log("\nUnique constraint salary_rate_config_position_...:");
  for (const r of constraint.rows) console.log(`  ${r.conname}: ${r.def}`);
  if (!constraint.rows.length) console.log("  (missing)");

  console.log("\nIndexes:");
  for (const r of indexes.rows) console.log(`  ${r.indexname}: ${r.indexdef}`);

  console.log("\nDuplicate groups (position,type,shift,date) count>1:");
  for (const r of dupGroups.rows) {
    console.log(
      `  ${r.position}|${r.employment_type}|${r.shift}|${r.effective_date} x${r.c} tenants=${r.tenants} bu=${r.bus}`,
    );
  }
  if (!dupGroups.rows.length) console.log("  none");

  console.log("\nGroups spanning multiple tenants (same key):", crossTenantDup.rows[0].groups);

  console.log("\nRLS policies:");
  for (const r of policies.rows) {
    console.log(`  ${r.policyname} [${r.cmd}]`);
    console.log(`    USING: ${r.qual ?? ""}`);
    if (r.with_check) console.log(`    WITH CHECK: ${r.with_check}`);
  }

  console.log("\nHR table UNIQUE constraints:");
  for (const r of hrUniques.rows) console.log(`  ${r.tbl}.${r.conname}: ${r.def}`);

  await client.end();
}

async function main() {
  await inspect("PRODUCTION", ".env.local.production-backup-2026-08-25");
  await inspect("STAGING", ".env.staging.local");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
