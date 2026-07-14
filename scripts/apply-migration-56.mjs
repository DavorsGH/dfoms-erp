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
      resolve(
        process.cwd(),
        "scripts",
        "56_supervisor_employees_directory_fix.sql",
      ),
      "utf8",
    );

    console.log("Applying 56_supervisor_employees_directory_fix.sql...");
    await client.query(sql);
    console.log("Applied 56_supervisor_employees_directory_fix.sql");

    const policies = await client.query(`
      SELECT tablename, policyname, cmd
      FROM pg_policies
      WHERE tablename IN ('employees', 'roster_history')
        AND cmd = 'SELECT'
      ORDER BY tablename, policyname
    `);
    console.log("SELECT policies:", JSON.stringify(policies.rows, null, 2));

    const rosterCount = await client.query(
      "SELECT COUNT(*)::int AS count FROM roster_history",
    );
    console.log("roster_history rows:", rosterCount.rows[0]?.count);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
