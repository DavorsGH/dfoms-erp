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
    const { rows } = await client.query(`
      SELECT proname
      FROM pg_proc
      WHERE proname IN (
        'preview_finished_product_delete',
        'delete_finished_product_cascade',
        'preview_raw_material_delete',
        'delete_raw_material_cascade',
        'delete_raw_material_purchase'
      )
      ORDER BY proname
    `);

    await client.query(`NOTIFY pgrst, 'reload schema'`);
    console.log("PostgREST schema reload notified.");
    console.log("Functions in database:", rows.map((row) => row.proname).join(", "));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
