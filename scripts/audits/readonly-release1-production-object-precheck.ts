/**
 * Read-only: confirm Release 1 objects are absent or non-conflicting on production.
 * npx tsx scripts/audits/readonly-release1-production-object-precheck.ts --env-file .env.local.production-backup-2026-08-25
 */
import { connectPg } from "../lib/pg-connect";

const PROD_REF = "tvcurcnmasnocwdxzgvz";

const OBJECTS = [
  "public.inventory_stock_adjustment_register_links",
  "public.salary_advance_register",
];

const FUNCTIONS = [
  "public.save_salary_advances_bulk(jsonb)",
  "public.update_production_batch(uuid, uuid, date, uuid, numeric, text, jsonb, date, date)",
  "public.assert_inventory_month_open(uuid, uuid, date)",
];

function parseArgs(argv: string[]) {
  return {
    envFile: argv.includes("--env-file")
      ? argv[argv.indexOf("--env-file") + 1]
      : ".env.local.production-backup-2026-08-25",
  };
}

async function main() {
  const { envFile } = parseArgs(process.argv.slice(2));
  const { client } = await connectPg({
    envFiles: [envFile],
  });
  console.log(`Connected (${envFile}) — production ref must contain ${PROD_REF}`);

  for (const rel of OBJECTS) {
    const { rows } = (await client.query(
      `SELECT to_regclass($1::text) AS reg`,
      [rel],
    )) as { rows: { reg: string | null }[] };
    const reg = rows[0]?.reg;
    console.log(
      `${rel}: ${reg ?? "missing"} ${reg ? "⚠ already exists — review schema before migrate" : "✓ absent (expected pre-migrate)"}`,
    );
  }

  for (const fn of FUNCTIONS) {
    const { rows } = (await client.query(
      `SELECT p.oid::regprocedure::text AS sig
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = split_part($1, '.', 1)
         AND p.proname = split_part(split_part($1, '.', 2), '(', 1)
       LIMIT 5`,
      [fn],
    )) as { rows: { sig: string }[] };
    const match = rows.find((r) => r.sig.startsWith(fn.split("(")[0]));
    console.log(
      `${fn}: ${match ? `exists as ${match.sig}` : "not found (will be created/replaced by migration)"}`,
    );
  }

  const guard = (await client.query(`
    SELECT count(*)::int AS n FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND (
        coalesce(p.qual, '') ~* 'is_super_admin\\s*\\('
        OR coalesce(p.with_check, '') ~* 'is_super_admin\\s*\\('
      )
      AND NOT (
        coalesce(p.qual, '') ILIKE '%tenant_matches(%'
        OR coalesce(p.qual, '') ILIKE '%current_user_tenant_id()%'
        OR coalesce(p.with_check, '') ILIKE '%tenant_matches(%'
        OR coalesce(p.with_check, '') ILIKE '%current_user_tenant_id()%'
      )
  `)) as { rows: { n: number }[] };
  console.log(
    `\npolicy_tenant_scope_guard (is_super_admin without tenant scope): ${guard.rows[0]?.n ?? "?"} rows (expected 0)`,
  );

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
