import { readFileSync } from "node:fs";
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
    const policies = await client.query(`
      SELECT tablename, policyname, cmd, qual, with_check
      FROM pg_policies
      WHERE tablename IN ('roster_history', 'sites', 'employees', 'clients', 'roster_config')
      ORDER BY tablename, policyname, cmd
    `);
    console.log("POLICIES:", JSON.stringify(policies.rows, null, 2));

    const applied = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE policyname = 'roster_history_rbac_select'
          AND qual LIKE '%supervisor%'
          AND qual NOT LIKE '%can_access_employee_record%'
      ) AS supervisor_full_select_applied
    `);
    console.log("CHECK:", applied.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
