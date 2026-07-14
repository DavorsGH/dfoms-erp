import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required in .env.local to apply migrations.");
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const sql = readFileSync(
      resolve(process.cwd(), "scripts", "53_client_portal_roster_fix.sql"),
      "utf8",
    );

    console.log("Applying 53_client_portal_roster_fix.sql...");
    await client.query(sql);
    console.log("Applied 53_client_portal_roster_fix.sql");

    const verification = await client.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM pg_proc WHERE proname = 'client_can_view_roster_project'
        ) AS project_helper_exists,
        EXISTS (
          SELECT 1 FROM pg_proc WHERE proname = 'client_can_view_roster_employee'
        ) AS employee_helper_exists;
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
