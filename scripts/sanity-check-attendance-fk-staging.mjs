import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

function loadEnvForce(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    process.env[key] = value;
  }
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  throw new Error("DATABASE_URL missing for staging (.env.staging.local)");
}

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  const q1 = await client.query(`
    SELECT
      conname AS constraint_name,
      conrelid::regclass AS child_table,
      confrelid::regclass AS parent_table,
      pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'attendance_register'::regclass
      AND confrelid = 'employees'::regclass
  `);

  const q2 = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'attendance_register'
      AND column_name = 'tenant_id'
  `);

  const q3 = await client.query(`
    SELECT ar.*
    FROM attendance_register ar
    LEFT JOIN employees e
      ON ar.tenant_id = e.tenant_id
     AND ar.staff_id = e.staff_id
    WHERE e.staff_id IS NULL
  `);

  const q4 = await client.query(`
    SELECT count(*)::int AS total_attendance_rows
    FROM attendance_register
  `);

  console.log("=== 1. FK constraint (attendance_register -> employees) ===");
  console.log(JSON.stringify(q1.rows, null, 2));

  console.log("=== 2. tenant_id column on attendance_register ===");
  console.log(JSON.stringify(q2.rows, null, 2));

  console.log("=== 3. Orphaned attendance_register rows (expect 0) ===");
  console.log("orphan_count:", q3.rowCount);
  if (q3.rowCount > 0) {
    const sample = q3.rows.slice(0, 3);
    console.log(JSON.stringify(sample, null, 2));
  }

  console.log("=== 4. Total attendance_register rows ===");
  console.log(JSON.stringify(q4.rows, null, 2));
} finally {
  await client.end();
}
