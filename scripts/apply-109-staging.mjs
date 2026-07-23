/**
 * Apply 109_lookup_config_tenant_pks.sql to staging, verify PKs,
 * and run a rolled-back scratch INSERT (Caanta severity_options "High").
 *
 * Usage: node scripts/apply-109-staging.mjs
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

const DAVORS = "00000001-0000-4000-8000-000000000001";
const EXPECTED = [
  ["action_status_options", "PRIMARY KEY (tenant_id, name)"],
  ["complaint_priority_options", "PRIMARY KEY (tenant_id, name)"],
  ["contract_status_options", "PRIMARY KEY (tenant_id, name)"],
  ["equipment_status_options", "PRIMARY KEY (tenant_id, name)"],
  ["incident_type_options", "PRIMARY KEY (tenant_id, name)"],
  ["inspection_result_options", "PRIMARY KEY (tenant_id, name)"],
  ["risk_level_options", "PRIMARY KEY (tenant_id, name)"],
  ["severity_options", "PRIMARY KEY (tenant_id, name)"],
  ["service_types", "PRIMARY KEY (tenant_id, name)"],
  ["ssnit_rates", "PRIMARY KEY (tenant_id, rate_name)"],
  ["operations_config", "PRIMARY KEY (tenant_id, config_key)"],
  ["paye_config", "PRIMARY KEY (tenant_id, config_key)"],
  ["ssnit_config", "PRIMARY KEY (tenant_id, config_key)"],
  ["paye_bands", "PRIMARY KEY (tenant_id, band_name, tax_year)"],
  ["roster_history", "PRIMARY KEY (tenant_id, roster_number)"],
  ["asset_register", "PRIMARY KEY (tenant_id, asset_id)"],
  ["equipment_register", "PRIMARY KEY (tenant_id, equipment_id)"],
];

const sql = readFileSync(
  resolve(process.cwd(), "../../06 Database/109_lookup_config_tenant_pks.sql"),
  "utf8",
);

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`Applying 109 to ${projectRef}...`);
await client.query(sql);
await client.query(`NOTIFY pgrst, 'reload schema'`);
console.log("SUCCESS (schema reload notified).");

const pkRows = [];
for (const [table, expected] of EXPECTED) {
  const { rows } = await client.query(
    `
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = $1::regclass AND contype = 'p'
    `,
    [`public.${table}`],
  );
  const def = rows[0]?.def ?? "(none)";
  pkRows.push({
    table,
    pk: def,
    ok: def === expected,
  });
}
console.log("\n=== PK VERIFY ===");
console.table(pkRows);
const failed = pkRows.filter((r) => !r.ok);
if (failed.length) {
  throw new Error(`PK verify failed for: ${failed.map((r) => r.table).join(", ")}`);
}

const caanta = await client.query(
  `
  SELECT id, name
  FROM tenants
  WHERE id <> $1::uuid
    AND (
      name ILIKE '%caanta%'
      OR slug ILIKE '%caanta%'
    )
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1
  `,
  [DAVORS],
);
if (!caanta.rows[0]) {
  throw new Error("No Caanta tenant found on staging for scratch test");
}
const caantaId = caanta.rows[0].id;
console.log("\nCaanta tenant:", caanta.rows[0]);

const davorsHigh = await client.query(
  `
  SELECT tenant_id, name
  FROM severity_options
  WHERE tenant_id = $1::uuid AND name = 'High'
  `,
  [DAVORS],
);
console.log("Davors High row:", davorsHigh.rows);

await client.query("BEGIN");
try {
  await client.query(
    `
    INSERT INTO severity_options (tenant_id, name)
    VALUES ($1::uuid, 'High')
    `,
    [caantaId],
  );
  const both = await client.query(
    `
    SELECT tenant_id, name
    FROM severity_options
    WHERE name = 'High'
    ORDER BY tenant_id
    `,
  );
  console.log("\n=== SCRATCH INSERT (before rollback) ===");
  console.table(both.rows);
  if (both.rows.length < 2) {
    throw new Error("Expected both Davors and Caanta High rows after insert");
  }
  await client.query("ROLLBACK");
  console.log("Scratch INSERT rolled back.");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
}

const after = await client.query(
  `
  SELECT tenant_id, name
  FROM severity_options
  WHERE name = 'High'
  ORDER BY tenant_id
  `,
);
console.log("\n=== AFTER ROLLBACK (High rows) ===");
console.table(after.rows);

await client.end();
console.log("\nDONE");
