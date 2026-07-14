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
      resolve(process.cwd(), "scripts", "52_supervisor_roster_visibility.sql"),
      "utf8",
    );

    console.log("Applying 52_supervisor_roster_visibility.sql...");
    await client.query(sql);
    console.log("Applied 52_supervisor_roster_visibility.sql");

    const policies = await client.query(`
      SELECT tablename, policyname, cmd, qual
      FROM pg_policies
      WHERE tablename IN ('sites', 'employees', 'roster_history')
        AND cmd = 'SELECT'
      ORDER BY tablename
    `);
    console.log("SELECT policies:", JSON.stringify(policies.rows, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
