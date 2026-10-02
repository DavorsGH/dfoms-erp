import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

try {
  loadEnvFile(resolve(process.cwd(), ".env.staging.local"));
} catch {
  /* optional */
}
loadEnvFile(resolve(process.cwd(), ".env.local"));

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  throw new Error("DATABASE_URL missing");
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const fn = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_duty_roster_employee_display_scoped'
    LIMIT 1
  `);
  console.log(fn.rows[0]?.def ?? "NOT FOUND");

  const cons = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public.leave_types'::regclass
  `);
  console.log("\nleave_types constraints:", JSON.stringify(cons.rows, null, 2));

  const grants = await client.query(`
    SELECT pg_get_function_identity_arguments(p.oid) AS args,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_employee_leave_balances_for_year'
  `);
  console.log("\ncreate_employee_leave_balances_for_year:", JSON.stringify(grants.rows, null, 2));

  const buFn = await client.query(`
    SELECT pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'user_has_business_unit_access'
    LIMIT 1
  `);
  console.log("\nuser_has_business_unit_access:", buFn.rows[0]?.args ?? "NOT FOUND");
  console.log(buFn.rows[0]?.def ?? "");
} finally {
  await client.end();
}
