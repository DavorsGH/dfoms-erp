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
if (!databaseUrl) throw new Error("DATABASE_URL missing for staging");

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const targets = [
  ["work_orders", "work_order_no"],
  ["complaint_register", "complaint_no"],
  ["corrective_actions", "action_no"],
  ["failed_inspections", "issue_no"],
  ["incident_register", "incident_no"],
  ["employees", "employee_id"],
  ["fixed_assets", "asset_id"],
];

const targetColByTable = Object.fromEntries(targets);

console.log("=== ENV ===");
const envInfo = await client.query(
  `SELECT current_database() AS db, inet_server_addr()::text AS host`,
);
console.log(JSON.stringify(envInfo.rows[0], null, 2));

console.log("\n=== PK defs for the 7 ===");
const pks = await client.query(`
  SELECT c.conrelid::regclass::text AS table_name, c.conname,
         pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c
  WHERE c.contype = 'p'
    AND c.conrelid = ANY (ARRAY[
      'work_orders'::regclass,
      'complaint_register'::regclass,
      'corrective_actions'::regclass,
      'failed_inspections'::regclass,
      'incident_register'::regclass,
      'employees'::regclass,
      'fixed_assets'::regclass
    ])
  ORDER BY 1
`);
console.log(JSON.stringify(pks.rows, null, 2));

console.log("\n=== 1. ALL inbound FKs to the 7 tables ===");
const fks = await client.query(`
  SELECT
    c.conname AS constraint_name,
    c.conrelid::regclass::text AS referencing_table,
    array_agg(a_src.attname ORDER BY u.ord) AS referencing_columns,
    c.confrelid::regclass::text AS referenced_table,
    array_agg(a_tgt.attname ORDER BY u.ord) AS referenced_columns,
    pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c
  JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS u(src, tgt, ord)
    ON true
  JOIN pg_attribute a_src
    ON a_src.attrelid = c.conrelid AND a_src.attnum = u.src
  JOIN pg_attribute a_tgt
    ON a_tgt.attrelid = c.confrelid AND a_tgt.attnum = u.tgt
  WHERE c.contype = 'f'
    AND c.confrelid = ANY (ARRAY[
      'work_orders'::regclass,
      'complaint_register'::regclass,
      'corrective_actions'::regclass,
      'failed_inspections'::regclass,
      'incident_register'::regclass,
      'employees'::regclass,
      'fixed_assets'::regclass
    ])
  GROUP BY c.oid, c.conname, c.conrelid, c.confrelid
  ORDER BY referenced_table, referencing_table, constraint_name
`);
console.log(JSON.stringify(fks.rows, null, 2));
console.log("ALL inbound COUNT:", fks.rows.length);

const filtered = fks.rows.filter((r) => {
  const expected = targetColByTable[r.referenced_table];
  return expected ? r.referenced_columns.includes(expected) : false;
});

console.log("\n=== 1b. FILTERED to the 7 PK columns only ===");
for (const row of filtered) {
  const srcCols = Array.isArray(row.referencing_columns)
    ? row.referencing_columns.join(",")
    : String(row.referencing_columns).replace(/[{}]/g, "");
  const tgtCols = Array.isArray(row.referenced_columns)
    ? row.referenced_columns.join(",")
    : String(row.referenced_columns).replace(/[{}]/g, "");
  console.log(
    `${row.referenced_table}.${tgtCols} <- ${row.referencing_table}.${srcCols} | ${row.constraint_name}`,
  );
}
console.log("FILTERED COUNT:", filtered.length);

const staffOnly = fks.rows.filter(
  (r) =>
    r.referenced_table === "employees" &&
    !r.referenced_columns.includes("employee_id"),
);
console.log("\n=== 1c. employees FKs NOT on employee_id (excluded) ===");
console.log(JSON.stringify(staffOnly, null, 2));

console.log("\n=== 2. tenant_id presence ===");
const tables = [
  ...new Set([
    ...targets.map(([t]) => t),
    ...filtered.map((r) => r.referencing_table.replace(/^public\./, "")),
  ]),
];
const tenantCheck = await client.query(
  `
  SELECT c.table_name,
         bool_or(c.column_name = 'tenant_id') AS has_tenant_id
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = ANY($1::text[])
  GROUP BY c.table_name
  ORDER BY c.table_name
`,
  [tables],
);
console.log(JSON.stringify(tenantCheck.rows, null, 2));

console.log("\n=== 3. Cross-tenant duplicate codes ===");
for (const [table, col] of targets) {
  const dup = await client.query(`
    SELECT
      ${client.escapeIdentifier(col)} AS code,
      count(*)::int AS row_count,
      count(DISTINCT tenant_id)::int AS tenant_count,
      array_agg(DISTINCT tenant_id::text ORDER BY tenant_id::text) AS tenant_ids
    FROM ${client.escapeIdentifier(table)}
    GROUP BY 1
    HAVING count(DISTINCT tenant_id) > 1
    ORDER BY 1
  `);
  console.log(
    `${table}.${col}:`,
    dup.rows.length === 0 ? "NONE" : JSON.stringify(dup.rows, null, 2),
  );
}

console.log("\n=== 3b. Same-tenant duplicate codes (should be impossible under current PK) ===");
for (const [table, col] of targets) {
  const dup = await client.query(`
    SELECT
      ${client.escapeIdentifier(col)} AS code,
      tenant_id::text AS tenant_id,
      count(*)::int AS row_count
    FROM ${client.escapeIdentifier(table)}
    GROUP BY 1, 2
    HAVING count(*) > 1
    ORDER BY 1, 2
  `);
  console.log(
    `${table}.${col}:`,
    dup.rows.length === 0 ? "NONE" : JSON.stringify(dup.rows, null, 2),
  );
}

console.log("\n=== Row counts / tenant counts for the 7 ===");
for (const [table] of targets) {
  const stats = await client.query(`
    SELECT count(*)::int AS rows,
           count(DISTINCT tenant_id)::int AS tenants
    FROM ${client.escapeIdentifier(table)}
  `);
  console.log(table + ":", stats.rows[0]);
}

await client.end();
