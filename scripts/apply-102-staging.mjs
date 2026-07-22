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
  throw new Error(`REFUSING: expected staging wieflwbfdmjtsdnwbfii, got ${projectRef}`);
}

const sql = readFileSync(
  resolve(process.cwd(), "../../06 Database/102_tenant_code_and_id_sequences.sql"),
  "utf8",
);

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`Applying 102_tenant_code_and_id_sequences.sql to ${projectRef}...`);
await client.query(sql);
console.log("SUCCESS.\n");

console.log("=== tenant_code values ===");
const tenants = await client.query(
  `SELECT id::text, name, slug, tenant_code FROM tenants ORDER BY created_at`,
);
console.table(tenants.rows);

const davorsId = "00000001-0000-4000-8000-000000000001";

console.log("\n=== generate_next_code sequential test (Davors / EMP) ===");
const codes = [];
for (let i = 0; i < 5; i++) {
  const r = await client.query(
    `SELECT generate_next_code($1::uuid, 'EMP', 4) AS code`,
    [davorsId],
  );
  codes.push(r.rows[0].code);
  console.log(`  call ${i + 1}: ${r.rows[0].code}`);
}

const expected = ["DF-EMP-0001", "DF-EMP-0002", "DF-EMP-0003", "DF-EMP-0004", "DF-EMP-0005"];
const seqOk = JSON.stringify(codes) === JSON.stringify(expected);
console.log(seqOk ? "PASS sequential" : `FAIL expected ${expected.join(", ")}`);

console.log("\n=== generate_next_code Caanta / WO ===");
const caanta = await client.query(
  `SELECT id FROM tenants WHERE name = 'Caanta Market'`,
);
const caantaId = caanta.rows[0].id;
for (let i = 0; i < 2; i++) {
  const r = await client.query(
    `SELECT generate_next_code($1::uuid, 'WO', 4) AS code`,
    [caantaId],
  );
  console.log(`  call ${i + 1}: ${r.rows[0].code}`);
}

console.log("\n=== RLS: authenticated direct INSERT into id_sequences must fail ===");
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE authenticated");
  // No JWT / no user — tenant_matches false; no INSERT policy anyway
  await client.query(
    `INSERT INTO id_sequences (tenant_id, entity_type, next_value)
     VALUES ($1::uuid, 'HACK', 1)`,
    [davorsId],
  );
  await client.query("ROLLBACK");
  console.log("FAIL: authenticated insert unexpectedly succeeded");
} catch (error) {
  await client.query("ROLLBACK");
  console.log(`PASS: insert blocked — ${error.message}`);
}

console.log("\n=== RLS: authenticated direct UPDATE into id_sequences must fail ===");
{
  const before = await client.query(
    `SELECT next_value FROM id_sequences
     WHERE tenant_id = $1::uuid AND entity_type = 'EMP'`,
    [davorsId],
  );
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE authenticated");
  const upd = await client.query(
    `UPDATE id_sequences SET next_value = 999
     WHERE tenant_id = $1::uuid AND entity_type = 'EMP'
     RETURNING next_value`,
    [davorsId],
  );
  await client.query("ROLLBACK");
  const after = await client.query(
    `SELECT next_value FROM id_sequences
     WHERE tenant_id = $1::uuid AND entity_type = 'EMP'`,
    [davorsId],
  );
  // No UPDATE policy => RLS denies by affecting 0 rows (not always an error).
  if (
    upd.rowCount === 0 &&
    after.rows[0]?.next_value === before.rows[0]?.next_value
  ) {
    console.log("PASS: update blocked (0 rows / value unchanged)");
  } else {
    console.log(
      `FAIL: authenticated update modified data — before=${JSON.stringify(before.rows)} after=${JSON.stringify(after.rows)} rowCount=${upd.rowCount}`,
    );
  }
}

console.log("\n=== Policy inventory on id_sequences ===");
const policies = await client.query(`
  SELECT
    pol.polname,
    CASE pol.polcmd
      WHEN 'r' THEN 'SELECT'
      WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE'
      WHEN 'd' THEN 'DELETE'
      WHEN '*' THEN 'ALL'
    END AS cmd
  FROM pg_policy pol
  WHERE pol.polrelid = 'public.id_sequences'::regclass
  ORDER BY pol.polname
`);
console.table(policies.rows);

// Cleanup test sequence rows created during verification (keep schema)
await client.query(
  `DELETE FROM id_sequences
   WHERE (tenant_id = $1::uuid AND entity_type = 'EMP')
      OR (tenant_id = $2::uuid AND entity_type = 'WO')`,
  [davorsId, caantaId],
);
console.log("\nCleaned verification id_sequences rows (EMP/WO test counters).");

await client.end();
