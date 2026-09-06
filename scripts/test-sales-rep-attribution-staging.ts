/**
 * Staging verification: create_product_sale persists sales_rep_id.
 *
 * Run after apply-286-287:
 *   npx tsx scripts/test-sales-rep-attribution-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

for (const envFile of [".env.staging.local", ".env.local"]) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), envFile), "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch {
    // optional
  }
}

const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("DATABASE_URL or SUPABASE_DB_URL required");
  process.exit(1);
}

const ddlUrl = url.replace(":6543/", ":5432/");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const client = new pg.Client({
    connectionString: ddlUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const fnReady = await client.query<{ ok: boolean }>(`
    SELECT pg_get_functiondef(p.oid) LIKE '%v_sales_rep_id text :=%' AS ok
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='create_product_sale' LIMIT 1
  `);
  if (!fnReady.rows[0]?.ok) {
    throw new Error(
      "create_product_sale not migrated — run: npx tsx scripts/apply-286-287-sales-rep-attribution-staging.ts --confirm-286-287",
    );
  }

  const productRow = await client.query<{
    id: string;
    tenant_id: string;
    product_name: string;
    current_stock: string;
  }>(`
    SELECT fp.id, fp.tenant_id, fp.product_name, fp.current_stock::text
    FROM finished_products fp
    WHERE fp.is_archived = false
      AND fp.current_stock > 0
    ORDER BY fp.current_stock DESC
    LIMIT 1
  `);
  assert(productRow.rowCount && productRow.rows[0], "No in-stock finished product on staging");

  const employeeRow = await client.query<{ employee_id: string; full_name: string }>(`
    SELECT employee_id, full_name
    FROM employees
    WHERE tenant_id = $1::uuid
    LIMIT 1
  `, [productRow.rows[0].tenant_id]);
  assert(employeeRow.rowCount && employeeRow.rows[0], "No employee for product tenant");

  const testRepId = employeeRow.rows[0].employee_id;
  const today = new Date().toISOString().slice(0, 10);

  const saleResult = await client.query<{ create_product_sale: string }>(`
    SELECT public.create_product_sale(
      $1::date,
      NULL,
      NULL,
      'Sales Rep Attribution Test',
      $2::uuid,
      1,
      1,
      1,
      'Paid',
      $1::date,
      'test-sales-rep-attribution-staging',
      'auto-test',
      'PSI',
      $3,
      NULL
    ) AS create_product_sale
  `, [today, productRow.rows[0].id, testRepId]);

  const incomeId = saleResult.rows[0]?.create_product_sale;
  assert(incomeId, "create_product_sale returned null");

  const incomeRow = await client.query<{ sales_rep_id: string | null; invoice_no: string }>(`
    SELECT sales_rep_id, invoice_no
    FROM income_register
    WHERE id = $1::uuid
  `, [incomeId]);

  assert(incomeRow.rows[0]?.sales_rep_id === testRepId, `Expected sales_rep_id=${testRepId}, got ${incomeRow.rows[0]?.sales_rep_id}`);

  const qCol = await client.query(`
    SELECT assigned_sales_rep_id
    FROM client_quotations
    LIMIT 1
  `);
  assert(qCol.rowCount !== null, "assigned_sales_rep_id column missing");

  console.log("PASS: create_product_sale persisted sales_rep_id", {
    incomeId,
    invoiceNo: incomeRow.rows[0]?.invoice_no,
    salesRepId: incomeRow.rows[0]?.sales_rep_id,
    repName: employeeRow.rows[0].full_name,
    product: productRow.rows[0].product_name,
  });
  console.log("PASS: client_quotations.assigned_sales_rep_id column readable");

  await client.end();
}

main().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
