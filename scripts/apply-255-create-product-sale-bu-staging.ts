/**
 * Apply scripts/255_create_product_sale_and_opportunity_business_unit.sql to staging.
 *
 * Usage: npx tsx scripts/apply-255-create-product-sale-bu-staging.ts
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

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL not configured for staging");
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "scripts/255_create_product_sale_and_opportunity_business_unit.sql",
      ),
      "utf8",
    );
    console.log("Applying 255_create_product_sale_and_opportunity_business_unit.sql …");
    await client.query(sql);

    const { rows } = await client.query(`
      SELECT p.proname,
             pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('create_product_sale', 'create_sales_opportunity')
      ORDER BY p.proname, p.oid
    `);

    for (const row of rows) {
      console.log(`${row.proname}(${row.args})`);
      if (!String(row.args).includes("p_business_unit_id")) {
        throw new Error(`${row.proname} missing p_business_unit_id`);
      }
    }

    console.log("PASS: 255 applied on staging.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
