/**
 * Staging smoke checks for leave entitlement policy (script 119).
 * Usage: node scripts/verify-119-leave-entitlement-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) throw new Error("DATABASE_URL missing");

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const tenant = "00000001-0000-4000-8000-000000000001";

const before = await client.query(
  "SELECT count(*)::int AS n, coalesce(sum(entitled_days),0)::numeric AS sum_entitled FROM employee_leave_balances",
);
console.log("BEFORE balances", before.rows[0]);

await client.query(
  `
  INSERT INTO leave_entitlement_policy (tenant_id, position, employment_type, leave_type, entitled_days)
  VALUES
    ($1, 'Security Guard', 'Full-Time', 'Annual Leave', 21),
    ($1, 'Security Guard', 'Full-Time', 'Sick Leave', 5),
    ($1, 'Security Guard', 'Full-Time', 'Unpaid Leave', 0)
  ON CONFLICT DO NOTHING
  `,
  [tenant],
);

const resolved = await client.query(
  `
  SELECT
    public.resolve_leave_entitlement($1::uuid, 'Security Guard', 'Full-Time', 'Annual Leave') AS annual_policy,
    public.resolve_leave_entitlement($1::uuid, 'Security Guard', 'Full-Time', 'Sick Leave') AS sick_policy,
    public.resolve_leave_entitlement($1::uuid, 'NoSuchPos', 'Full-Time', 'Annual Leave') AS annual_fallback,
    public.resolve_leave_entitlement($1::uuid, 'NoSuchPos', 'Full-Time', 'Sick Leave') AS sick_fallback
  `,
  [tenant],
);
console.log("RESOLVE (expect 21/5/15/0)", resolved.rows[0]);

const sample = await client.query(
  `
  SELECT employee_id, year, entitled_days
  FROM employee_leave_balances
  ORDER BY employee_id
  LIMIT 5
  `,
);
console.log("SAMPLE existing rows (untouched)", sample.rows);

const after = await client.query(
  "SELECT count(*)::int AS n, coalesce(sum(entitled_days),0)::numeric AS sum_entitled FROM employee_leave_balances",
);
console.log("AFTER balances (expect identical to BEFORE)", after.rows[0]);

await client.query(
  `
  DELETE FROM leave_entitlement_policy
  WHERE tenant_id = $1
    AND position = 'Security Guard'
    AND employment_type = 'Full-Time'
  `,
  [tenant],
);
console.log("Cleaned temporary policy rows");

await client.end();
