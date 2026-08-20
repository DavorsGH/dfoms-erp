/**
 * Apply scripts/228_quotation_contract_link.sql to production.
 *
 * Usage: npx tsx scripts/apply-228-quotation-contract-link-production.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "xlgddbvnfjrgfgfdhqbv";

async function verify228(client: Awaited<ReturnType<typeof connectPg>>["client"]) {
  const { rows } = await client.query(`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_quotations'
      AND column_name = 'contract_id'
  `);

  if (rows.length !== 1) {
    throw new Error("Missing column client_quotations.contract_id");
  }

  console.log("PASS 228: client_quotations.contract_id present on production");
}

async function main() {
  const sql = readFileSync(resolve("scripts/228_quotation_contract_link.sql"), "utf8");
  const { client, envFile } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.production.local", ".env.local"],
  });
  console.log(`Connected via ${envFile}`);

  try {
    await client.query(sql);
    await verify228(client);
    console.log("Applied 228_quotation_contract_link.sql to production");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
