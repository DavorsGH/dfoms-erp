/**
 * Apply scripts/246_fix_tax_ledger_system_adjustment_source_id_cast.sql
 *
 * Staging:
 *   npx tsx scripts/apply-246-fix-tax-ledger-source-id-cast.ts --env=staging
 *
 * Production (only after staging OK + explicit approval):
 *   npx tsx scripts/apply-246-fix-tax-ledger-source-id-cast.ts --env=production --apply
 *
 * Default for production is dry-run (prints function defs / refuses to apply
 * without --apply). Staging applies immediately (staging-first workflow).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

function parseArgs(argv: string[]) {
  const envArg = argv.find((a) => a.startsWith("--env="))?.slice("--env=".length);
  const apply = argv.includes("--apply");
  if (envArg !== "staging" && envArg !== "production") {
    throw new Error("Pass --env=staging or --env=production");
  }
  return { env: envArg as "staging" | "production", apply };
}

async function main() {
  const { env, apply } = parseArgs(process.argv.slice(2));
  const requiredProjectRef = env === "staging" ? STAGING_REF : PRODUCTION_REF;
  const envFiles =
    env === "staging"
      ? [".env.staging.local"]
      : [".env.local.backup", ".env.local"];

  const shouldApply = env === "staging" || apply;
  if (env === "production" && !apply) {
    console.log(
      "Production dry-run: will not apply. Re-run with --apply after approval.",
    );
  }

  const { client, envFile } = await connectPg({
    requiredProjectRef,
    envFiles,
  });
  console.log(`Connected ${env} via ${envFile} (apply=${shouldApply})`);

  try {
    if (shouldApply) {
      const sql = readFileSync(
        resolve(process.cwd(), "scripts/246_fix_tax_ledger_system_adjustment_source_id_cast.sql"),
        "utf8",
      );
      console.log("Applying 246_fix_tax_ledger_system_adjustment_source_id_cast.sql …");
      await client.query(sql);
      console.log("Applied.");
    }

    const funcs = await client.query(`
      SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'block_tax_ledger_for_system_adjustment_income',
          'clear_system_adjustment_tax_ledger',
          'replace_income_register_tax_ledger_entries'
        )
      ORDER BY p.proname
    `);
    console.log(`\nFunctions present: ${funcs.rows.length}`);
    for (const row of funcs.rows) {
      const hasSafeCast =
        typeof row.def === "string" &&
        (row.def.includes("id::text") || row.def.includes("NEW.id::text"));
      console.log(
        `- ${row.proname}: ${
          row.proname === "replace_income_register_tax_ledger_entries"
            ? "rpc ok"
            : hasSafeCast
              ? "cast-safe"
              : "CHECK BODY"
        }`,
      );
    }

    // Prove insert works after fix (staging always; production only when applied)
    if (shouldApply) {
      await client.query("BEGIN");
      try {
        const probe = await client.query(`
          INSERT INTO public.tax_ledger_entries (
            tenant_id, entry_date, period_month, direction, tax_component,
            rate_pct, taxable_base, tax_amount, status, source_type, source_id,
            notes
          )
          SELECT
            i.tenant_id, CURRENT_DATE, date_trunc('month', CURRENT_DATE)::date,
            'output', 'vat_bundle', 20, 100, 20, 'open', 'income_register',
            i.id::text, '246-probe-rollback'
          FROM public.income_register i
          WHERE COALESCE(i.is_system_adjustment, false) = false
          LIMIT 1
          RETURNING id::text
        `);
        console.log(
          `\nProbe INSERT after fix: ${
            probe.rows[0] ? "OK " + probe.rows[0].id : "SKIP (no income row)"
          }`,
        );
      } catch (e) {
        console.error("Probe INSERT FAILED:", e instanceof Error ? e.message : e);
        throw e;
      } finally {
        await client.query("ROLLBACK");
        console.log("Probe rolled back.");
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
