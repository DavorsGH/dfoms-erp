/**
 * Apply scripts/235_create_product_sale_optional_customer.sql to staging.
 *
 * Usage: npx tsx scripts/apply-235-create-product-sale-optional-customer-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes(STAGING_PROJECT_REF)) {
    throw new Error(`Expected staging project ${STAGING_PROJECT_REF}`);
  }

  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const password =
    process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? "";
  const client = new pg.Client({
    connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const sql = readFileSync(
      resolve(process.cwd(), "scripts/235_create_product_sale_optional_customer.sql"),
      "utf8",
    );
    console.log("Applying 235_create_product_sale_optional_customer.sql …");
    await client.query(sql);

    const { rows } = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'create_product_sale'
      ORDER BY p.oid DESC
      LIMIT 1
    `);
    const def = String(rows[0]?.def ?? "");
    if (def.includes("Select a contract client or enter an other payer name")) {
      throw new Error("Customer-required guard still present after apply");
    }
    console.log("Customer-required guard removed: true");
    console.log("PASS: 235 applied on staging.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
