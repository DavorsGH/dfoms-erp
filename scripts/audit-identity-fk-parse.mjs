/**
 * Parse schema-only.sql for identity-style FKs (offline fallback).
 * Also tries live staging pg if DATABASE_URL works.
 */
import { readFileSync, writeFileSync } from "node:fs";
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

const LOOKUP = new Set([
  "tenants",
  "departments",
  "positions",
  "payment_methods",
  "expense_categories",
  "income_categories",
  "allowance_types",
  "deduction_types",
  "leave_types",
  "loan_types",
  "product_categories",
  "units_of_measure",
  "tax_codes",
  "chart_of_accounts",
  "account_types",
  "bank_accounts",
  "currencies",
  "countries",
  "roles",
  "permissions",
  "crm_products",
  "crm_product_prices",
  "operations_config",
  "payroll_config",
  "notification_templates",
  "email_templates",
  "feature_definitions",
  "plan_features",
  "subscription_plans",
  "salary_settings",
  "shift_definitions",
]);

function stripQuotes(s) {
  return s.replaceAll('"', "").trim();
}

function parseSqlFks(sql) {
  const re =
    /ALTER TABLE(?: ONLY)?\s+(?:public\.)?(\w+)\s+ADD CONSTRAINT\s+(\w+)\s+FOREIGN KEY\s*\(([^)]+)\)\s+REFERENCES\s+(?:public\.)?(\w+)\s*\(([^)]+)\)/gi;
  const rows = [];
  let m;
  while ((m = re.exec(sql))) {
    const table = m[1];
    const con = m[2];
    const src = m[3].split(",").map(stripQuotes);
    const refTable = m[4];
    const ref = m[5].split(",").map(stripQuotes);
    rows.push({
      constraint_name: con,
      referencing_table: table,
      referencing_columns: src,
      referenced_table: refTable,
      referenced_columns: ref,
      source: "schema-only.sql",
    });
  }
  return rows;
}

function isIdentityFk(row) {
  if (LOOKUP.has(row.referenced_table)) return false;
  const nonTenantRef = row.referenced_columns.filter((c) => c !== "tenant_id");
  if (!nonTenantRef.length) return false;
  return nonTenantRef.some(
    (c) =>
      /(_id|_no|_code)$/i.test(c) ||
      ["supervisor", "assigned_cleaner", "reported_by"].includes(c),
  );
}

function normalize(row) {
  return {
    constraint_name: row.constraint_name,
    referencing_table: row.referencing_table,
    referencing_columns: row.referencing_columns,
    referenced_table: row.referenced_table,
    referenced_columns: row.referenced_columns,
    nonTenantSrc: row.referencing_columns.filter((c) => c !== "tenant_id"),
    nonTenantRef: row.referenced_columns.filter((c) => c !== "tenant_id"),
    source: row.source,
  };
}

const sql = readFileSync(resolve("schema-only.sql"), "utf8");
const fromFile = parseSqlFks(sql).filter(isIdentityFk).map(normalize);

let fromLive = null;
let liveError = null;
try {
  const databaseUrl = resolveDatabaseUrl();
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const result = await client.query(`
    SELECT
      c.conname AS constraint_name,
      c.conrelid::regclass::text AS referencing_table,
      array_agg(a_src.attname ORDER BY u.ord) AS referencing_columns,
      c.confrelid::regclass::text AS referenced_table,
      array_agg(a_tgt.attname ORDER BY u.ord) AS referenced_columns
    FROM pg_constraint c
    JOIN pg_class cls_src ON cls_src.oid = c.conrelid
    JOIN pg_namespace n_src ON n_src.oid = cls_src.relnamespace
    JOIN pg_class cls_tgt ON cls_tgt.oid = c.confrelid
    JOIN pg_namespace n_tgt ON n_tgt.oid = cls_tgt.relnamespace
    JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS u(src, tgt, ord) ON true
    JOIN pg_attribute a_src ON a_src.attrelid = c.conrelid AND a_src.attnum = u.src AND NOT a_src.attisdropped
    JOIN pg_attribute a_tgt ON a_tgt.attrelid = c.confrelid AND a_tgt.attnum = u.tgt AND NOT a_tgt.attisdropped
    WHERE c.contype = 'f'
      AND n_src.nspname = 'public'
      AND n_tgt.nspname = 'public'
    GROUP BY c.oid, c.conname, c.conrelid, c.confrelid
    ORDER BY 1
  `);
  fromLive = result.rows
    .map((r) => ({ ...r, source: "live-staging" }))
    .filter(isIdentityFk)
    .map(normalize);
  await client.end();
} catch (err) {
  liveError = err.message;
}

const out = {
  liveError,
  fromFileCount: fromFile.length,
  fromLiveCount: fromLive?.length ?? null,
  fromFile,
  fromLive,
};
writeFileSync(
  resolve("scripts/.tmp-identity-fk-audit.json"),
  JSON.stringify(out, null, 2),
);

console.log("liveError:", liveError);
console.log("fromFileCount:", fromFile.length);
console.log("fromLiveCount:", fromLive?.length ?? null);
console.log("\n=== FROM schema-only.sql ===");
for (const r of fromFile.sort((a, b) =>
  `${a.referenced_table}.${a.referencing_table}.${a.constraint_name}`.localeCompare(
    `${b.referenced_table}.${b.referencing_table}.${b.constraint_name}`,
  ),
)) {
  console.log(
    `${r.constraint_name} | ${r.referencing_table}.(${r.nonTenantSrc.join(",")}) -> ${r.referenced_table}.(${r.nonTenantRef.join(",")})`,
  );
}
if (fromLive) {
  console.log("\n=== FROM live staging ===");
  for (const r of fromLive.sort((a, b) =>
    `${a.referenced_table}.${a.referencing_table}.${a.constraint_name}`.localeCompare(
      `${b.referenced_table}.${b.referencing_table}.${b.constraint_name}`,
    ),
  )) {
    console.log(
      `${r.constraint_name} | ${r.referencing_table}.(${r.nonTenantSrc.join(",")}) -> ${r.referenced_table}.(${r.nonTenantRef.join(",")})`,
    );
  }
}
