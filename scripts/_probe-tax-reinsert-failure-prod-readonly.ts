/**
 * READ-ONLY (+ rolled-back INSERT) probe: why client-invoice tax reinsert
 * produced zero rows on production after syncIncomeRegisterTaxLedger delete.
 *
 *   npx tsx scripts/_probe-tax-reinsert-failure-prod-readonly.ts
 */
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const INCOME_0001 = "1b09a1e5-30d3-4b51-98b5-05bc4a2f470d";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local.backup", ".env.local"],
  });
  console.log(`=== Tax reinsert failure probe (PRODUCTION READ-ONLY) ===`);
  console.log(`Connected via ${envFile}`);
  console.log(`Now UTC: ${new Date().toISOString()}`);
  console.log(
    `NOTE: Local agent disk-full earlier was %TEMP% on the workstation — NOT Vercel/Supabase.`,
  );

  try {
    const col = await client.query(`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tax_ledger_entries'
        AND column_name = 'source_id'
    `);
    console.log(`\n1) source_id type: ${JSON.stringify(col.rows[0] ?? null)}`);

    const trig = await client.query(`
      SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'block_tax_ledger_for_system_adjustment_income',
          'clear_system_adjustment_tax_ledger'
        )
      ORDER BY p.proname
    `);
    console.log(`\n2) Trigger function bodies:`);
    for (const row of trig.rows) {
      console.log(`--- ${row.proname} ---`);
      console.log(row.def);
    }

    console.log(`\n3) Predicate tests (uuid vs text):`);
    const tests = [
      {
        name: "uuid_col = text_param (block-trigger style)",
        sql: `SELECT EXISTS (
          SELECT 1 FROM public.income_register i
          WHERE i.id = $1::text AND i.is_system_adjustment IS TRUE
        ) AS hit`,
      },
      {
        name: "uuid_col::text = text_param (safe)",
        sql: `SELECT EXISTS (
          SELECT 1 FROM public.income_register i
          WHERE i.id::text = $1 AND i.is_system_adjustment IS TRUE
        ) AS hit`,
      },
      {
        name: "text_col = uuid_param (clear-trigger style)",
        sql: `SELECT EXISTS (
          SELECT 1 FROM public.tax_ledger_entries t
          WHERE t.source_id = $1::uuid
          LIMIT 1
        ) AS hit`,
      },
    ];
    for (const t of tests) {
      try {
        const r = await client.query(t.sql, [INCOME_0001]);
        console.log(`  OK  ${t.name}: ${JSON.stringify(r.rows[0])}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`  FAIL ${t.name}: ${msg}`);
      }
    }

    console.log(`\n4) BEGIN / INSERT one VAT leg for DF-INV-0001 / ROLLBACK:`);
    await client.query("BEGIN");
    try {
      const ins = await client.query(
        `
        INSERT INTO public.tax_ledger_entries (
          tenant_id, entry_date, period_month, direction, tax_component,
          rate_pct, taxable_base, tax_amount, status, source_type, source_id,
          counterparty_name, notes
        ) VALUES (
          $1::uuid, '2026-07-20', '2026-07-01', 'output', 'vat_bundle',
          20, 31825.18, 4184.09, 'open', 'income_register', $2,
          'probe', 'PROBE Invoice DF-INV-0001 — will rollback'
        )
        RETURNING id::text, source_id::text
      `,
        [DAVORS, INCOME_0001],
      );
      console.log(`  INSERT OK: ${JSON.stringify(ins.rows[0])}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  INSERT FAILED: ${msg}`);
    } finally {
      await client.query("ROLLBACK");
      console.log(`  ROLLED BACK`);
    }

    // Re-check no probe row lingered
    const leftover = await client.query(
      `
      SELECT COUNT(*)::int AS n
      FROM public.tax_ledger_entries
      WHERE notes LIKE 'PROBE Invoice DF-INV-0001%'
    `,
    );
    console.log(`  leftover probe rows: ${leftover.rows[0]?.n}`);

    console.log(`\n5) Unique index / checks still present:`);
    const idx = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'tax_ledger_entries'
      ORDER BY indexname
    `);
    for (const row of idx.rows) {
      console.log(`  ${row.indexname}: ${row.indexdef}`);
    }

    console.log(`\n=== END ===`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
