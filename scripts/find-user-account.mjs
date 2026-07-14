import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const databaseUrl = resolveDatabaseUrl();
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const result = await client.query(`
    SELECT ua.auth_uid, ua.email, ua.employee_id, ua.client_id, ua.is_active,
           COALESCE(e.full_name, c.client_name, ua.email) AS display_name
    FROM user_accounts ua
    LEFT JOIN employees e ON e.employee_id = ua.employee_id
    LEFT JOIN clients c ON c.client_id = ua.client_id
    WHERE e.full_name ILIKE '%paul%adonu%'
       OR ua.email ILIKE '%paul%'
    ORDER BY display_name
  `);
  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
