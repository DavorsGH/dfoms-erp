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
      resolve(process.cwd(), "scripts", "51_fix_batch.sql"),
      "utf8",
    );

    console.log("Applying 51_fix_batch.sql...");
    await client.query(sql);
    console.log("Applied 51_fix_batch.sql");

    const verification = await client.query(`
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_policies
          WHERE policyname = 'employees_rbac_select'
            AND tablename = 'employees'
        ) AS employees_policy_exists,
        EXISTS (
          SELECT 1
          FROM pg_policies
          WHERE policyname = 'roster_history_rbac_select'
            AND tablename = 'roster_history'
        ) AS roster_select_policy_exists;
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
