import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required in .env.local to apply migrations.",
    );
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const sql = readFileSync(
      resolve(process.cwd(), "scripts", "50_client_portal.sql"),
      "utf8",
    );

    console.log("Applying 50_client_portal.sql...");
    await client.query(sql);
    console.log("Applied 50_client_portal.sql");

    const verification = await client.query(`
      SELECT
        EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_user_client_id') AS client_id_helper_exists,
        EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'income_register_select') AS income_rls_exists,
        EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'clients_rbac_select') AS clients_rls_exists;
    `);

    console.log("Verification:", verification.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
