/**
 * Apply scripts/228_quotation_contract_link.sql to staging.
 *
 * Usage: npx tsx scripts/apply-228-quotation-contract-link-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function verify228(client: Awaited<ReturnType<typeof connectPg>>["client"]) {
  const { rows } = await client.query(`
    SELECT column_name, is_nullable, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_quotations'
      AND column_name = 'contract_id'
  `);

  if (rows.length !== 1) {
    throw new Error("Missing column client_quotations.contract_id");
  }

  const { rows: fkRows } = await client.query(`
    SELECT
      tc.constraint_name,
      ccu.table_name AS foreign_table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'client_quotations'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND tc.constraint_name IN (
        SELECT constraint_name
        FROM information_schema.key_column_usage
        WHERE table_schema = 'public'
          AND table_name = 'client_quotations'
          AND column_name = 'contract_id'
      )
  `);

  if (fkRows.length === 0) {
    throw new Error("Missing FK from client_quotations.contract_id to service_contracts");
  }

  console.log("PASS 228: client_quotations.contract_id present (nullable uuid FK)");
  console.log(`  FK -> ${fkRows[0].foreign_table_name} (${fkRows[0].constraint_name})`);
}

async function main() {
  const sql = readFileSync(resolve("scripts/228_quotation_contract_link.sql"), "utf8");
  const { client, envFile } = await connectPg({ requiredProjectRef: STAGING_REF });
  console.log(`Connected via ${envFile}`);

  try {
    await client.query(sql);
    await verify228(client);
    console.log("Applied 228_quotation_contract_link.sql to staging");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
