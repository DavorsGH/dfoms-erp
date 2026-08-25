/**
 * Apply scripts/244_client_invoice_income_link.sql to staging only.
 *
 *   npx tsx scripts/apply-244-client-invoice-income-link-staging.ts
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
      resolve(process.cwd(), "scripts/244_client_invoice_income_link.sql"),
      "utf8",
    );
    console.log("Applying 244_client_invoice_income_link.sql …");
    await client.query(sql);

    const col = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'income_register'
        AND column_name = 'client_invoice_id'
    `);
    console.log("client_invoice_id column:", col.rows);

    const fk = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = 'income_register_client_invoice_id_fkey'
    `);
    console.log("FK:", fk.rows);

    const linked = await client.query(`
      SELECT COUNT(*)::int AS linked
      FROM public.income_register
      WHERE service_category = 'Client Invoice'
        AND client_invoice_id IS NOT NULL
    `);
    console.log("Linked Client Invoice income rows:", linked.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
