/** Read-only: production NULL business_unit_id counts per table + schema section 3/4 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const TABLES = [
  "projects","income_register","finished_products","crm_products","sales_opportunities",
  "product_purchases","production_batches","purchase_orders","purchase_order_items",
  "raw_material_purchases","raw_material_stock_adjustments","finished_product_stock_adjustments",
  "finished_product_balances","raw_material_balances","stock_movements","inventory_balance_config",
];

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

async function main() {
  loadEnv(resolve(".env.local.backup"));
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    console.log("=== 2) NULL business_unit_id counts (Davors tenant, per table) ===");
    const results: Record<string, string | number> = {};
    for (const table of TABLES) {
      const col = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1 AND column_name='business_unit_id'
         ) AS has_column`,
        [table],
      );
      if (!col.rows[0]?.has_column) {
        results[`${table}_null`] = "COLUMN_MISSING";
        continue;
      }
      const { rows } = await client.query(
        `SELECT count(*)::bigint AS c FROM public.${table}
         WHERE tenant_id = $1 AND business_unit_id IS NULL`,
        [DAVORS_TENANT_ID],
      );
      results[`${table}_null`] = rows[0]?.c ?? 0;
    }
    console.log(JSON.stringify(results, null, 2));

    console.log("\n=== 3) business_units columns (production) ===");
    const prodCols = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='business_units'
      ORDER BY ordinal_position`);
    console.log(JSON.stringify(prodCols.rows, null, 2));
  } finally {
    await client.end();
  }

  loadEnv(resolve(".env.staging.local"));
  const staging = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await staging.connect();
  try {
    console.log("\n=== 3) business_units columns (staging) ===");
    const stagingCols = await staging.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='business_units'
      ORDER BY ordinal_position`);
    console.log(JSON.stringify(stagingCols.rows, null, 2));
  } finally {
    await staging.end();
  }

  loadEnv(resolve(".env.local.backup"));
  const client2 = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client2.connect();
  try {
    console.log("\n=== 4) user_has_business_unit_access + user_business_unit_access ===");
    const fn = await client2.query(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='user_has_business_unit_access'`);
    const tbl = await client2.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='user_business_unit_access'
      ) AS exists`);
    const pol = await client2.query(`
      SELECT count(*)::int AS count FROM pg_policies
      WHERE COALESCE(qual,'') ILIKE '%user_has_business_unit_access%'
         OR COALESCE(with_check,'') ILIKE '%user_has_business_unit_access%'`);
    console.log(JSON.stringify({
      user_business_unit_access_table: tbl.rows[0],
      user_has_business_unit_access_overloads: fn.rows,
      total_rls_policies_referencing_fn: pol.rows[0]?.count,
    }, null, 2));
  } finally {
    await client2.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
