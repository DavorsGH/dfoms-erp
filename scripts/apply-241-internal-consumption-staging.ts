/**
 * Apply scripts/241_internal_consumption_wac_balance_sheet.sql to staging only.
 *
 *   npx tsx scripts/apply-241-internal-consumption-staging.ts
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
    const sql = readFileSync(
      resolve(process.cwd(), "scripts/241_internal_consumption_wac_balance_sheet.sql"),
      "utf8",
    );
    console.log("Applying 241_internal_consumption_wac_balance_sheet.sql …");
    await client.query(sql);

    for (const fn of [
      "finished_product_weighted_avg_cost",
      "apply_internal_consumption",
    ]) {
      const res = await client.query(
        `
        SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = $1
        ORDER BY 2
      `,
        [fn],
      );
      if (res.rows.length === 0) {
        throw new Error(`Missing function public.${fn}`);
      }
      for (const row of res.rows) {
        console.log(`PASS function ${row.proname}(${row.args})`);
      }
    }

    const wac = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'finished_product_weighted_avg_cost'
    `);
    const wacDef = String(wac.rows[0]?.def ?? "");
    if (!wacDef.includes("internal_consumption")) {
      throw new Error("WAC function missing internal_consumption subtraction");
    }
    console.log("PASS WAC subtracts internal_consumption");

    const icFn = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'apply_internal_consumption'
    `);
    const icDef = String(icFn.rows[0]?.def ?? "");
    if (!icDef.includes("Finished Goods - Internal Use")) {
      throw new Error("apply_internal_consumption missing new sub-category");
    }
    if (icDef.indexOf("finished_product_weighted_avg_cost") > icDef.indexOf("current_stock = current_stock -")) {
      throw new Error("apply_internal_consumption still computes WAC after stock reduction");
    }
    console.log("PASS apply_internal_consumption WAC-before-stock + new sub-category");

    const sub = await client.query(`
      SELECT COUNT(*)::int AS n
      FROM expense_subcategories
      WHERE name = 'Finished Goods - Internal Use'
    `);
    if (Number(sub.rows[0]?.n ?? 0) === 0) {
      throw new Error("Missing expense sub-category Finished Goods - Internal Use");
    }
    console.log(`PASS expense sub-category exists (${sub.rows[0]?.n} tenant rows)`);

    const legacy = await client.query(`
      SELECT COUNT(*)::int AS n FROM expense_register
      WHERE sub_category = 'Cleaning Supplies - Internal Use'
    `);
    console.log(
      `legacy Cleaning Supplies rows remaining: ${legacy.rows[0]?.n ?? "?"}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
