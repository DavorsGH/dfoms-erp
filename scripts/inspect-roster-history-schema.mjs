import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

loadEnvFile(resolve(process.cwd(), ".env.local"));
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
await client.connect();
const cols = await client.query(
  "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='roster_history' ORDER BY ordinal_position",
);
console.log(JSON.stringify(cols.rows, null, 2));
const emps = await client.query(
  "SELECT employee_id, full_name, assigned_site_id FROM employees WHERE assigned_site_id IN ('SI-001','SI-002','SI-003') ORDER BY assigned_site_id LIMIT 10",
);
console.log(JSON.stringify(emps.rows, null, 2));
await client.end();
