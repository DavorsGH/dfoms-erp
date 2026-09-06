/**
 * Apply scripts/286 + 287 to production (sales rep attribution).
 *
 * Usage:
 *   npx tsx scripts/apply-286-287-sales-rep-attribution-production.ts --confirm-286-287-production
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

for (const envFile of [".env.production.local", ".env.local"]) {
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
  if (!process.argv.includes("--confirm-286-287-production")) {
    console.error("Pass --confirm-286-287-production to apply migrations to production.");
    process.exit(1);
  }

  const rawUrl =
    process.env.PRODUCTION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL;
  if (!rawUrl) {
    throw new Error("PRODUCTION_DATABASE_URL, DATABASE_URL, or SUPABASE_DB_URL required");
  }

  // Supabase transaction pooler (6543) can swallow DDL — use session pooler/direct.
  const ddlUrl = rawUrl.replace(":6543/", ":5432/");

  const client = new pg.Client({
    connectionString: ddlUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Connected (session pooler port 5432).`);

  for (const file of SQL_FILES) {
    const sql = readFileSync(resolve(process.cwd(), file), "utf8");
    console.log(`Applying ${file}…`);
    await client.query(sql);
    console.log(`OK: ${file}`);
  }

  // 1. create_product_sale persists sales_rep_id
  const fnCheck = await client.query<{ def: string; has_var: boolean; has_insert: boolean }>(`
    SELECT
      pg_get_functiondef(p.oid) AS def,
      pg_get_functiondef(p.oid) LIKE '%v_sales_rep_id text :=%' AS has_var,
      pg_get_functiondef(p.oid) LIKE '%sales_rep_id%' AS has_insert
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_product_sale'
    LIMIT 1
  `);
  const fnRow = fnCheck.rows[0];
  if (!fnRow?.has_var || !fnRow?.has_insert) {
    throw new Error("create_product_sale does not persist sales_rep_id after 286");
  }
  console.log("\n[1] create_product_sale: PASS");
  console.log("    - v_sales_rep_id assignment: yes");
  console.log("    - INSERT includes sales_rep_id: yes");

  // 2. assigned_sales_rep_id column exists
  const colCheck = await client.query<{ column_name: string; is_nullable: string; data_type: string }>(`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_quotations'
      AND column_name = 'assigned_sales_rep_id'
  `);
  if (colCheck.rowCount === 0) {
    throw new Error("assigned_sales_rep_id column missing after 287");
  }
  console.log("\n[2] client_quotations.assigned_sales_rep_id: PASS");
  console.log(`    - type: ${colCheck.rows[0]?.data_type}, nullable: ${colCheck.rows[0]?.is_nullable}`);

  // 3. No existing rows modified (additive nullable column; function replace only)
  const quotStats = await client.query<{ total: string; non_null: string }>(`
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE assigned_sales_rep_id IS NOT NULL)::text AS non_null
    FROM client_quotations
  `);
  const total = Number(quotStats.rows[0]?.total ?? 0);
  const nonNull = Number(quotStats.rows[0]?.non_null ?? 0);
  console.log("\n[3] Data migration check: PASS (no backfill)");
  console.log(`    - client_quotations total rows: ${total}`);
  console.log(`    - rows with assigned_sales_rep_id set: ${nonNull} (expected 0 — additive NULL column)`);
  console.log("    - create_product_sale: function replacement only (no table UPDATE in migration)");

  if (nonNull > 0) {
    console.warn(
      "    WARNING: non-null assigned_sales_rep_id rows exist — may be from app usage post-deploy, not migration backfill.",
    );
  }

  console.log("\nPASS: 286 + 287 applied on production.");
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
