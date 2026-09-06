/**
 * Apply scripts/278_void_product_sale_cogs_reversal_sale_date.sql to staging.
 *   npx tsx scripts/apply-278-void-cogs-reversal-date-staging.ts
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

  const sql = readFileSync(
    resolve(process.cwd(), "scripts/278_void_product_sale_cogs_reversal_sale_date.sql"),
    "utf8",
  );

  console.log("Applying 278_void_product_sale_cogs_reversal_sale_date.sql …");
  await client.query(sql);

  const check = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'void_product_sale'
  `);
  const def = String(check.rows[0]?.def ?? "");
  if (!def.includes("COALESCE(v_sale.date, CURRENT_DATE)")) {
    throw new Error("Function body missing COALESCE(v_sale.date, CURRENT_DATE) for COGS reversal");
  }
  if (def.match(/CURRENT_DATE,\s*'Cost of Goods Sold'/)) {
    throw new Error("Function still uses bare CURRENT_DATE for COGS reversal date");
  }

  console.log("PASS: void_product_sale COGS reversal now uses COALESCE(v_sale.date, CURRENT_DATE)");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
