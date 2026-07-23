/**
 * Apply 110_positions_projects_pay_rate_tenant_pks.sql to staging and verify.
 * Usage: node scripts/apply-110-staging.mjs
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
  resolve(
    process.cwd(),
    "../../06 Database/110_positions_projects_pay_rate_tenant_pks.sql",
  ),
  "utf8",
);

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`Applying 110 to ${projectRef}...`);
await client.query(sql);
await client.query(`NOTIFY pgrst, 'reload schema'`);
console.log("SUCCESS (schema reload notified).");

const names = [
  "positions_pkey",
  "projects_pkey",
  "projects_id_unique",
  "pay_rate_structure_pkey",
  "employees_position_fkey",
  "employee_employment_history_position_fkey",
  "pay_rate_structure_position_fkey",
  "employees_contract_project_fkey",
  "payroll_history_project_contract_fkey",
  "payroll_processing_project_contract_fkey",
  "sites_project_id_fkey",
  "employee_employment_history_rate_id_fkey",
];

const { rows } = await client.query(
  `
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conname = ANY($1::text[])
  ORDER BY conname
  `,
  [names],
);
console.log("\n=== CONSTRAINT VERIFY ===");
console.table(rows);

await client.end();
console.log("DONE");
