/**
 * Apply scripts/286 + 287 to staging (sales rep attribution).
 *
 * Usage:
 *   npx tsx scripts/apply-286-287-sales-rep-attribution-staging.ts --confirm-286-287
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

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

for (const envFile of [".env.staging.local", ".env.local"]) {
  try {
    loadEnvForce(resolve(process.cwd(), envFile));
  } catch {
    // optional
  }
}

const SQL_FILES = [
  "scripts/286_create_product_sale_persist_sales_rep_id.sql",
  "scripts/287_client_quotations_assigned_sales_rep_id.sql",
] as const;

async function main() {
  if (!process.argv.includes("--confirm-286-287")) {
    console.error("Pass --confirm-286-287 to apply migrations to staging.");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error("DATABASE_URL or SUPABASE_DB_URL required");
  }

  // Supabase transaction pooler (6543) can swallow DDL — use session pooler/direct.
  const ddlUrl = url.replace(":6543/", ":5432/");

  const client = new pg.Client({
    connectionString: ddlUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  for (const file of SQL_FILES) {
    const sql = readFileSync(resolve(process.cwd(), file), "utf8");
    console.log(`Applying ${file}…`);
    await client.query(sql);
    console.log(`OK: ${file}`);
  }

  const fnCheck = await client.query<{ has_insert: boolean }>(`
    SELECT pg_get_functiondef(p.oid) LIKE '%v_sales_rep_id text :=%' AS has_insert
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_product_sale'
    LIMIT 1
  `);
  if (!fnCheck.rows[0]?.has_insert) {
    throw new Error("create_product_sale INSERT still missing sales_rep_id after 286");
  }

  const colCheck = await client.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_quotations'
      AND column_name = 'assigned_sales_rep_id'
  `);
  if (colCheck.rowCount === 0) {
    throw new Error("assigned_sales_rep_id column missing after 287");
  }

  console.log("\nPASS: 286 + 287 applied on staging.");
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
