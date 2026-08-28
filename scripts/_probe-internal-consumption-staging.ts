/**
 * Read-only staging probe: internal consumption mechanism + WAC formula.
 *   npx tsx scripts/_probe-internal-consumption-staging.ts
 */
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`Connected via ${envFile}`);

  try {
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM internal_consumption) AS ic_rows,
        (SELECT COUNT(*)::int FROM internal_consumption WHERE expense_register_id IS NOT NULL) AS ic_with_expense,
        (SELECT COUNT(*)::int FROM stock_movements WHERE movement_type = 'internal_consumption_out') AS sm_ic_out,
        (SELECT COUNT(*)::int FROM expense_register WHERE receipt_no LIKE 'IC-%') AS ic_expenses
    `);
    console.log("counts", JSON.stringify(counts.rows[0], null, 2));

    const fn = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'apply_internal_consumption'
      LIMIT 1
    `);
    const def: string = fn.rows[0]?.def ?? "";
    console.log(
      "apply_internal_consumption posts expense:",
      def.includes("INSERT INTO expense_register"),
    );
    console.log(
      "apply_internal_consumption uses WAC:",
      def.includes("finished_product_weighted_avg_cost"),
    );

    const wac = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'finished_product_weighted_avg_cost'
      LIMIT 1
    `);
    const wacDef: string = wac.rows[0]?.def ?? "";
    console.log(
      "WAC subtracts product-sale COGS:",
      wacDef.includes("income_register") && wacDef.includes("cogs_expense_id"),
    );
    console.log(
      "WAC mentions internal_consumption:",
      wacDef.toLowerCase().includes("internal_consumption"),
    );

    const triggers = await client.query(`
      SELECT tgname
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = 'internal_consumption' AND NOT t.tgisinternal
      ORDER BY tgname
    `);
    console.log("triggers", triggers.rows.map((r) => r.tgname));

    const sample = await client.query(`
      SELECT ic.id, ic.consumption_date, ic.quantity, ic.expense_register_id,
             e.amount, e.sub_category, e.payment_status, e.receipt_no
      FROM internal_consumption ic
      LEFT JOIN expense_register e ON e.id = ic.expense_register_id
      ORDER BY ic.consumption_date DESC
      LIMIT 5
    `);
    console.log("sample rows", JSON.stringify(sample.rows, null, 2));

    const oldSub = await client.query(`
      SELECT COUNT(*)::int AS n FROM expense_register
      WHERE sub_category = 'Cleaning Supplies - Internal Use'
    `);
    console.log("legacy sub_category rows", oldSub.rows[0]?.n);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
