import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

const envFile = process.argv[2] ?? ".env.staging.local";
for (const line of readFileSync(resolve(envFile), "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const i = trimmed.indexOf("=");
  if (i === -1) continue;
  process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
}

const DAVORS = "00000001-0000-4000-8000-000000000001";

const client = new pg.Client({
  connectionString: resolveDatabaseUrl(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const probe = await client.query(
  `SELECT employee_id, full_name, tenant_id, phone, basic_salary, bank_name
   FROM public.employees
   WHERE tenant_id = $1::uuid
   ORDER BY employee_id
   LIMIT 1`,
  [DAVORS],
);

console.log("=== pickEmployeeId equivalent (first row, ORDER BY employee_id) ===");
console.log(JSON.stringify(probe.rows[0] ?? null, null, 2));

const policies = await client.query(
  `SELECT policyname, cmd, permissive, roles::text, qual, with_check
   FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'employees'
   ORDER BY policyname, cmd`,
);

console.log("\n=== pg_policies public.employees ===");
for (const row of policies.rows) {
  console.log(JSON.stringify(row, null, 2));
  console.log("---");
}

await client.end();
