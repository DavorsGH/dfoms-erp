/**
 * Apply scripts/376_void_product_sale_block_returned_sales.sql to staging.
 *   npx tsx scripts/apply-376-void-block-returned-staging.ts
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
    resolve(process.cwd(), "scripts/376_void_product_sale_block_returned_sales.sql"),
    "utf8",
  );

  console.log("Applying 376_void_product_sale_block_returned_sales.sql …");
  await client.query(sql);

  const check = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'void_product_sale'
  `);
  const def = String(check.rows[0]?.def ?? "");
  if (!def.includes("Nothing left to cancel")) {
    throw new Error("void_product_sale missing fully-returned guard");
  }
  if (!def.includes("partly returned")) {
    throw new Error("void_product_sale missing partly-returned guard");
  }

  console.log("PASS: void_product_sale blocks cancel when sale has returns");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
