/**
 * Inventory FKs that point at operational identity columns
 * (employee_id, staff_id, client_id, site_code, work_order_no, etc.),
 * excluding pure tenant_id halves and known lookup-table refs.
 *
 * Run: node scripts/audit-identity-fk-staging.mjs
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
const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) throw new Error("DATABASE_URL missing for staging");
if (!databaseUrl.includes("wieflwbfdmjtsdnwbfii") && !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("wieflwbfdmjtsdnwbfii")) {
  console.warn("Warning: URL may not be staging — check carefully");
}

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const envInfo = await client.query(
  `SELECT current_database() AS db, inet_server_addr()::text AS host`,
);
console.log("ENV", envInfo.rows[0]);

// Known lookup / catalog tables whose FKs are already dropdowns / out of scope
const LOOKUP_TABLES = new Set([
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
  "shift_types",
  "employment_types",
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
  "feature_entitlements",
  "subscription_tiers",
  "crm_products",
  "crm_product_prices",
  "operations_config",
  "payroll_config",
  "salary_settings",
  "notification_templates",
  "email_templates",
]);

// Identity-ish referenced column names we care about
const IDENTITY_COL_RE =
  /^(employee_id|staff_id|client_id|customer_id|site_code|site_id|work_order_no|complaint_no|action_no|issue_no|incident_no|asset_id|product_id|purchase_order_no|po_number|invoice_no|invoice_id|order_id|sale_id|user_id|auth_user_id|project_id|project_code|contract_id|batch_id|lot_id|sku|item_id|finished_product_id|raw_material_id|warehouse_id|location_id|approver_id|manager_id|supervisor|assigned_cleaner|responsible_employee|reported_by)$/i;

const result = await client.query(`
  SELECT
    c.conname AS constraint_name,
    n_src.nspname AS referencing_schema,
    c.conrelid::regclass::text AS referencing_table,
    array_agg(a_src.attname ORDER BY u.ord) AS referencing_columns,
    n_tgt.nspname AS referenced_schema,
    c.confrelid::regclass::text AS referenced_table,
    array_agg(a_tgt.attname ORDER BY u.ord) AS referenced_columns,
    pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c
  JOIN pg_class cls_src ON cls_src.oid = c.conrelid
  JOIN pg_namespace n_src ON n_src.oid = cls_src.relnamespace
  JOIN pg_class cls_tgt ON cls_tgt.oid = c.confrelid
  JOIN pg_namespace n_tgt ON n_tgt.oid = cls_tgt.relnamespace
  JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS u(src, tgt, ord)
    ON true
  JOIN pg_attribute a_src
    ON a_src.attrelid = c.conrelid AND a_src.attnum = u.src AND NOT a_src.attisdropped
  JOIN pg_attribute a_tgt
    ON a_tgt.attrelid = c.confrelid AND a_tgt.attnum = u.tgt AND NOT a_tgt.attisdropped
  WHERE c.contype = 'f'
    AND n_src.nspname = 'public'
    AND n_tgt.nspname = 'public'
  GROUP BY c.oid, c.conname, c.conrelid, c.confrelid, n_src.nspname, n_tgt.nspname
  ORDER BY referencing_table, constraint_name
`);

const rows = result.rows.map((r) => {
  const refCols = r.referenced_columns;
  const srcCols = r.referencing_columns;
  const identityRefCols = refCols.filter(
    (col) => col !== "tenant_id" && IDENTITY_COL_RE.test(col),
  );
  // Also catch columns that look like IDs even if not in the fixed list:
  // referenced side ends with _id / _no / _code and isn't tenant_id
  const heuristicIdentity = refCols.filter((col) => {
    if (col === "tenant_id" || col === "id") return false;
    if (IDENTITY_COL_RE.test(col)) return true;
    return /(_id|_no|_code)$/i.test(col);
  });

  return {
    ...r,
    identityRefCols,
    heuristicIdentity,
    nonTenantSrc: srcCols.filter((c) => c !== "tenant_id"),
    nonTenantRef: refCols.filter((c) => c !== "tenant_id"),
  };
});

const identityFks = rows.filter((r) => {
  if (LOOKUP_TABLES.has(r.referenced_table)) return false;
  // Must have at least one non-tenant referenced identity column
  return r.heuristicIdentity.length > 0;
});

// Also dump ALL public FKs with non-tenant refs for completeness review
const allNonTenant = rows
  .filter((r) => r.nonTenantRef.length > 0)
  .map((r) => ({
    constraint_name: r.constraint_name,
    table_column: `${r.referencing_table}.(${r.nonTenantSrc.join(", ")})`,
    references: `${r.referenced_table}.(${r.nonTenantRef.join(", ")})`,
    definition: r.definition,
    is_lookup_ref: LOOKUP_TABLES.has(r.referenced_table),
    identity_hit: r.heuristicIdentity.length > 0,
  }));

const outPath = resolve(process.cwd(), "scripts/.tmp-identity-fk-audit.json");
writeFileSync(
  outPath,
  JSON.stringify(
    {
      env: envInfo.rows[0],
      identityFks: identityFks.map((r) => ({
        constraint_name: r.constraint_name,
        referencing_table: r.referencing_table,
        referencing_columns: r.referencing_columns,
        referenced_table: r.referenced_table,
        referenced_columns: r.referenced_columns,
        nonTenantSrc: r.nonTenantSrc,
        nonTenantRef: r.nonTenantRef,
        definition: r.definition,
      })),
      allNonTenant,
      counts: {
        allPublicFks: rows.length,
        allNonTenant: allNonTenant.length,
        identityFks: identityFks.length,
        lookupSkipped: allNonTenant.filter((r) => r.is_lookup_ref).length,
      },
    },
    null,
    2,
  ),
);

console.log("counts", {
  allPublicFks: rows.length,
  allNonTenant: allNonTenant.length,
  identityFks: identityFks.length,
});
console.log("\n=== IDENTITY FKs ===");
for (const r of identityFks) {
  console.log(
    `${r.constraint_name} | ${r.referencing_table}.(${r.nonTenantSrc.join(",")}) → ${r.referenced_table}.(${r.nonTenantRef.join(",")})`,
  );
}
console.log("\nWrote", outPath);
await client.end();
