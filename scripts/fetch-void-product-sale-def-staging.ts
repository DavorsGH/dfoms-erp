/**
 * Print live void_product_sale definition from staging.
 *   npx tsx scripts/fetch-void-product-sale-def-staging.ts
 */
import { connectPg } from "./lib/pg-connect";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local"],
  });
  console.log(`Connected via ${envFile}\n`);
  const r = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'void_product_sale'
  `);
  console.log(r.rows[0]?.def ?? "NOT FOUND");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
