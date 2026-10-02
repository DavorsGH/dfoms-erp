/**
 * Read-only: counts rows whose stored supplier/vendor text does not match
 * any suppliers.name for the same tenant (case/accent insensitive).
 */
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const connectionString =
  process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? "";

if (!connectionString) {
  console.error("Missing SUPABASE_DB_URL or DATABASE_URL in .env.local");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

const QUERIES = [
  {
    table: "expense_register",
    column: "vendor",
    sql: `
      SELECT e.tenant_id, COUNT(*)::bigint AS mismatch_count
      FROM expense_register e
      WHERE NULLIF(TRIM(e.vendor), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM suppliers s
          WHERE s.tenant_id = e.tenant_id
            AND s.name ILIKE TRIM(e.vendor)
        )
      GROUP BY e.tenant_id
      ORDER BY mismatch_count DESC
    `,
  },
  {
    table: "accounts_payable",
    column: "vendor_name",
    sql: `
      SELECT a.tenant_id, COUNT(*)::bigint AS mismatch_count
      FROM accounts_payable a
      WHERE NULLIF(TRIM(a.vendor_name), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM suppliers s
          WHERE s.tenant_id = a.tenant_id
            AND s.name ILIKE TRIM(a.vendor_name)
        )
      GROUP BY a.tenant_id
      ORDER BY mismatch_count DESC
    `,
  },
  {
    table: "fixed_assets",
    column: "vendor_name",
    sql: `
      SELECT f.tenant_id, COUNT(*)::bigint AS mismatch_count
      FROM fixed_assets f
      WHERE NULLIF(TRIM(f.vendor_name), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM suppliers s
          WHERE s.tenant_id = f.tenant_id
            AND s.name ILIKE TRIM(f.vendor_name)
        )
      GROUP BY f.tenant_id
      ORDER BY mismatch_count DESC
    `,
  },
  {
    table: "raw_material_purchases",
    column: "supplier",
    sql: `
      SELECT m.tenant_id, COUNT(*)::bigint AS mismatch_count
      FROM raw_material_purchases r
      JOIN raw_materials m ON m.id = r.material_id
      WHERE NULLIF(TRIM(r.supplier), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM suppliers s
          WHERE s.tenant_id = m.tenant_id
            AND s.name ILIKE TRIM(r.supplier)
        )
      GROUP BY m.tenant_id
      ORDER BY mismatch_count DESC
    `,
  },
];

async function main() {
  await client.connect();
  const summary = {};

  for (const { table, column, sql } of QUERIES) {
    const { rows } = await client.query(sql);
    const total = rows.reduce(
      (acc, row) => acc + Number(row.mismatch_count ?? 0),
      0,
    );
    summary[`${table}.${column}`] = {
      total_mismatch_rows: total,
      by_tenant: rows.map((row) => ({
        tenant_id: row.tenant_id,
        count: Number(row.mismatch_count),
      })),
    };
  }

  console.log(JSON.stringify(summary, null, 2));
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
