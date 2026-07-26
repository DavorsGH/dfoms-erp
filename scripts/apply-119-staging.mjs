/**
 * Apply 119_leave_entitlement_policy.sql to staging and verify RLS.
 * Usage: node scripts/apply-119-staging.mjs
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== "wieflwbfdmjtsdnwbfii") {
  throw new Error(
    `REFUSING: expected staging wieflwbfdmjtsdnwbfii, got ${projectRef}`,
  );
}

const sql = readFileSync(
  resolve(process.cwd(), "scripts/119_leave_entitlement_policy.sql"),
  "utf8",
);

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`Applying 119 to ${projectRef}...`);
await client.query(sql);
console.log("SUCCESS (schema reload notified via migration).");

const { rows: policies } = await client.query(`
  SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr,
         pg_get_expr(polwithcheck, polrelid) AS with_check
  FROM pg_policy
  WHERE polrelid = 'public.leave_entitlement_policy'::regclass
  ORDER BY polname
`);
console.log("\n=== RLS POLICIES ===");
console.table(policies);

const { rows: fns } = await client.query(`
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'resolve_leave_entitlement',
      'create_employee_leave_balances_for_year',
      'approve_leave_request'
    )
  ORDER BY p.proname
`);
console.log("\n=== FUNCTIONS ===");
console.table(fns);

const { rows: fallback } = await client.query(`
  SELECT
    public.resolve_leave_entitlement(
      '00000001-0000-4000-8000-000000000001'::uuid,
      'Security Guard',
      'Full-Time',
      'Annual Leave'
    ) AS annual_no_policy,
    public.resolve_leave_entitlement(
      '00000001-0000-4000-8000-000000000001'::uuid,
      'Security Guard',
      'Full-Time',
      'Sick Leave'
    ) AS sick_no_policy,
    public.resolve_leave_entitlement(
      '00000001-0000-4000-8000-000000000001'::uuid,
      'Security Guard',
      'Full-Time',
      'Unpaid Leave'
    ) AS unpaid_no_policy
`);
console.log("\n=== FALLBACK VERIFY (expect 15 / 0 / 0) ===");
console.table(fallback);

await client.end();
console.log("DONE");
