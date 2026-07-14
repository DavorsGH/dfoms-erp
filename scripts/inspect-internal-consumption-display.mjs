import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) throw new Error("DATABASE_URL missing");

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const columns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'internal_consumption'
      ORDER BY ordinal_position
    `);

    const rows = await client.query(`
      SELECT
        ic.id,
        ic.product_id,
        ic.quantity,
        ic.consumption_date,
        ic.reason,
        ic.expense_register_id,
        fp.product_code,
        fp.product_name,
        fp.is_archived
      FROM internal_consumption ic
      LEFT JOIN finished_products fp ON fp.id = ic.product_id
      ORDER BY ic.consumption_date DESC, ic.created_at DESC
    `);

    console.log(
      JSON.stringify(
        {
          columns: columns.rows.map((row) => row.column_name),
          rowCount: rows.rows.length,
          rows: rows.rows,
          note:
            "No void/status column on internal_consumption — grey display is a CSS issue, not row status.",
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
