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
      resolve(process.cwd(), "scripts", "49_employee_self_service.sql"),
      "utf8",
    );

    console.log("Applying 49_employee_self_service.sql...");
    await client.query(sql);
    console.log("Applied 49_employee_self_service.sql");

    const verification = await client.query(`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leave_types') AS leave_types_exists,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leave_requests') AS leave_requests_exists,
        EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'submit_leave_request') AS submit_rpc_exists,
        EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_user_employee_id') AS employee_id_helper_exists,
        (SELECT COUNT(*)::int FROM leave_approver_config) AS approver_config_rows;
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
