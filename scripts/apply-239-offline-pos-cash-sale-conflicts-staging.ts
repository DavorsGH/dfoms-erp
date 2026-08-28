/**
 * Apply scripts/239_offline_pos_cash_sale_conflicts.sql to staging only.
 *
 *   npx tsx scripts/apply-239-offline-pos-cash-sale-conflicts-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });
  console.log(`Connected via ${envFile}`);

  try {
    const enumCheck = await client.query(`
      SELECT 1
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'income_entry_type'
        AND e.enumlabel = 'offline_cash_suspense'
    `);
    console.log(
      enumCheck.rows[0]
        ? "Pre-check: income_entry_type already has offline_cash_suspense"
        : "Pre-check: offline_cash_suspense enum value will be added",
    );

    const sql = readFileSync(
      resolve(process.cwd(), "scripts/239_offline_pos_cash_sale_conflicts.sql"),
      "utf8",
    );
    console.log("Applying 239_offline_pos_cash_sale_conflicts.sql …");
    await client.query(sql);

    const enumAfter = await client.query(`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'income_entry_type'
        AND e.enumlabel = 'offline_cash_suspense'
    `);
    if (!enumAfter.rows[0]) {
      throw new Error("Missing income_entry_type.offline_cash_suspense");
    }
    console.log("PASS enum:", enumAfter.rows[0].enumlabel);

    for (const table of ["offline_sale_conflicts", "offline_pos_ops"]) {
      const tbl = await client.query(
        `
        SELECT c.relrowsecurity AS rls
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1
      `,
        [table],
      );
      if (!tbl.rows[0]) {
        throw new Error(`Missing table public.${table}`);
      }
      if (!tbl.rows[0].rls) {
        throw new Error(`RLS not enabled on public.${table}`);
      }
      console.log(`PASS table ${table} (RLS on)`);
    }

    const incomeCol = await client.query(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'income_register'
        AND column_name = 'client_op_id'
    `);
    if (!incomeCol.rows[0]) {
      throw new Error("Missing income_register.client_op_id");
    }
    console.log("PASS income_register.client_op_id:", incomeCol.rows[0].data_type);

    // Ensure no unique index was accidentally created on income client_op_id
    const badUnique = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'income_register'
        AND indexdef ILIKE '%UNIQUE%'
        AND indexdef ILIKE '%client_op_id%'
    `);
    if (badUnique.rows.length > 0) {
      throw new Error(
        `Unexpected unique index on income_register.client_op_id: ${badUnique.rows[0].indexname}`,
      );
    }
    console.log("PASS: no unique index on income_register.client_op_id");

    for (const fn of [
      "sync_offline_pos_cash_sale",
      "resolve_offline_sale_conflict",
      "_offline_pos_apply_cash_action",
    ]) {
      const rows = await client.query(
        `
        SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = $1
      `,
        [fn],
      );
      if (!rows.rows[0]) {
        throw new Error(`Missing function public.${fn}`);
      }
      console.log(`PASS function ${fn}(${rows.rows[0].args})`);
    }

    console.log("PASS: 239 offline POS cash sale conflicts applied on staging.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
