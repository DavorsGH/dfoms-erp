/**
 * Read-only: production BU RLS policies, NULL counts, schema, function check.
 *
 * Usage:
 *   npx tsx scripts/probe-production-bu-rls-readonly.ts --env-file .env.local.backup --allow-production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

const TABLES = [
  "projects",
  "income_register",
  "finished_products",
  "crm_products",
  "sales_opportunities",
  "product_purchases",
  "production_batches",
  "purchase_orders",
  "purchase_order_items",
  "raw_material_purchases",
  "raw_material_stock_adjustments",
  "finished_product_stock_adjustments",
  "finished_product_balances",
  "raw_material_balances",
  "stock_movements",
  "inventory_balance_config",
] as const;

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  let envFile = ".env.local.backup";
  let allowProduction = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--env-file" && args[i + 1]) {
      envFile = args[i + 1]!;
      i += 1;
    } else if (args[i] === "--allow-production") {
      allowProduction = true;
    }
  }
  return { envFile, allowProduction };
}

async function main() {
  const { envFile, allowProduction } = parseArgs();
  if (!allowProduction) {
    throw new Error("Pass --allow-production");
  }

  loadEnv(resolve(process.cwd(), envFile));
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCTION_REF)) {
    throw new Error(`Refusing: not production ref ${PRODUCTION_REF}`);
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    console.log("=== 1) RLS POLICIES (pg_policies) ===");
    const policies = await client.query(
      `
        SELECT tablename, policyname, cmd, qual, with_check
        FROM pg_policies
        WHERE tablename = ANY($1::text[])
        ORDER BY tablename, policyname
      `,
      [TABLES],
    );
    console.log(JSON.stringify(policies.rows, null, 2));
    console.log(`policy_row_count: ${policies.rows.length}`);

    console.log("\n=== 2) NULL business_unit_id counts (Davors tenant) ===");
    const nullCounts = await client.query(`
      SELECT
        (SELECT count(*)::bigint FROM projects WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS projects_null,
        (SELECT count(*)::bigint FROM income_register WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS income_register_null,
        (SELECT count(*)::bigint FROM finished_products WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS finished_products_null,
        (SELECT count(*)::bigint FROM crm_products WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS crm_products_null,
        (SELECT count(*)::bigint FROM sales_opportunities WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS sales_opportunities_null,
        (SELECT count(*)::bigint FROM product_purchases WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS product_purchases_null,
        (SELECT count(*)::bigint FROM production_batches WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS production_batches_null,
        (SELECT count(*)::bigint FROM purchase_orders WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS purchase_orders_null,
        (SELECT count(*)::bigint FROM purchase_order_items WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS purchase_order_items_null,
        (SELECT count(*)::bigint FROM raw_material_purchases WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS raw_material_purchases_null,
        (SELECT count(*)::bigint FROM raw_material_stock_adjustments WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS raw_material_stock_adjustments_null,
        (SELECT count(*)::bigint FROM finished_product_stock_adjustments WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS finished_product_stock_adjustments_null,
        (SELECT count(*)::bigint FROM finished_product_balances WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS finished_product_balances_null,
        (SELECT count(*)::bigint FROM raw_material_balances WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS raw_material_balances_null,
        (SELECT count(*)::bigint FROM stock_movements WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS stock_movements_null,
        (SELECT count(*)::bigint FROM inventory_balance_config WHERE business_unit_id IS NULL AND tenant_id = '${DAVORS_TENANT_ID}') AS inventory_balance_config_null
    `);
    console.log(JSON.stringify(nullCounts.rows[0], null, 2));

    console.log("\n=== 3) business_units columns (production) ===");
    const buCols = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'business_units'
      ORDER BY ordinal_position
    `);
    console.log(JSON.stringify(buCols.rows, null, 2));

    console.log("\n=== 3b) business_units columns (staging contrast) ===");
    loadEnv(resolve(process.cwd(), ".env.staging.local"));
    const stagingClient = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    await stagingClient.connect();
    try {
      const stagingBuCols = await stagingClient.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'business_units'
        ORDER BY ordinal_position
      `);
      console.log(JSON.stringify(stagingBuCols.rows, null, 2));

      const prodNames = new Set(buCols.rows.map((r) => r.column_name as string));
      const stagingNames = new Set(
        stagingBuCols.rows.map((r) => r.column_name as string),
      );
      const onlyProd = [...prodNames].filter((n) => !stagingNames.has(n));
      const onlyStaging = [...stagingNames].filter((n) => !prodNames.has(n));
      const typeDiffs: Array<{ column: string; production: unknown; staging: unknown }> = [];
      for (const name of [...prodNames].filter((n) => stagingNames.has(n))) {
        const p = buCols.rows.find((r) => r.column_name === name);
        const s = stagingBuCols.rows.find((r) => r.column_name === name);
        if (
          p?.data_type !== s?.data_type ||
          p?.is_nullable !== s?.is_nullable
        ) {
          typeDiffs.push({ column: name, production: p, staging: s });
        }
      }
      console.log("\n=== 3c) schema diff summary ===");
      console.log(
        JSON.stringify(
          {
            columns_only_on_production: onlyProd,
            columns_only_on_staging: onlyStaging,
            type_or_nullability_diffs: typeDiffs,
          },
          null,
          2,
        ),
      );
    } finally {
      await stagingClient.end();
    }

    // Reconnect prod client context - reload prod env for section 4
    loadEnv(resolve(process.cwd(), envFile));
    console.log("\n=== 4) user_has_business_unit_access + user_business_unit_access table ===");
    const fn = await client.query(`
      SELECT
        p.proname,
        pg_get_function_identity_arguments(p.oid) AS args,
        pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'user_has_business_unit_access'
      ORDER BY p.oid
    `);
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'user_business_unit_access'
      ) AS exists
    `);
    const policiesWithBuFn = await client.query(`
      SELECT count(*)::int AS count
      FROM pg_policies
      WHERE tablename = ANY($1::text[])
        AND (
          COALESCE(qual, '') ILIKE '%user_has_business_unit_access%'
          OR COALESCE(with_check, '') ILIKE '%user_has_business_unit_access%'
        )
    `, [TABLES]);
    console.log(
      JSON.stringify(
        {
          user_business_unit_access_table: tableExists.rows[0],
          user_has_business_unit_access_functions: fn.rows.map((r) => ({
            proname: r.proname,
            args: r.args,
          })),
          rls_policies_referencing_user_has_business_unit_access:
            policiesWithBuFn.rows[0]?.count,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
