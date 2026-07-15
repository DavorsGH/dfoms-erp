import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();

  try {
    const inv = await client.query(`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname IN (
          'internal_consumption','finished_products','raw_materials',
          'raw_material_purchases','stock_movements','production_batches'
        )
      ORDER BY 1
    `);

    const invCols = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (
          'internal_consumption','finished_products','raw_materials',
          'raw_material_purchases','stock_movements','production_batches'
        )
        AND column_name IN (
          'product_id','material_id','site_id','finished_product_id','reference_id','batch_id'
        )
      ORDER BY 1, 2
    `);

    const invIdx = await client.query(`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN (
          'internal_consumption','finished_products','raw_materials',
          'raw_material_purchases','stock_movements','production_batches'
        )
      ORDER BY 1, 2
    `);

    const vivian = await client.query(`
      SELECT ua.auth_uid, ua.role, e.employee_id, e.full_name
      FROM user_accounts ua
      LEFT JOIN employees e ON e.employee_id = ua.employee_id
      WHERE ua.role = 'supervisor'
      ORDER BY e.full_name
      LIMIT 3
    `);

    const supervisorSites = vivian.rows[0]
      ? await client.query(
          `
          SELECT site_code
          FROM user_account_supervisor_sites
          WHERE auth_uid = $1
          ORDER BY site_code
        `,
          [vivian.rows[0].auth_uid],
        )
      : { rows: [] };

    console.log(
      JSON.stringify(
        {
          inventory: inv.rows,
          inventoryColumns: invCols.rows,
          inventoryIndexes: invIdx.rows,
          supervisors: vivian.rows,
          sampleSupervisorSites: supervisorSites.rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
