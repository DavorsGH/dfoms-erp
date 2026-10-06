/**
 * STAGING ONLY: apply 371 + repair Davors zero-COGS sales.
 * npx tsx scripts/apply-371-zero-cogs-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`Staging 371 (${envFile})\n`);

  const sql = readFileSync(
    resolve(process.cwd(), "scripts/371_zero_cogs_historical_repair.sql"),
    "utf8",
  );
  await client.query(sql);
  console.log("371 SQL applied.");

  const { rows } = await client.query(
    `SELECT public.repair_zero_cogs_product_sales_for_tenant($1::uuid) AS result`,
    [DAVORS],
  );
  console.log("Davors repair result:", rows[0]?.result);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
