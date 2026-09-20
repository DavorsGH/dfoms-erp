/**
 * Read-only probe: sales_rep_id coverage on income_register + quotations fields.
 * Run: npx tsx scripts/probe-sales-rep-id-coverage-staging.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";
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
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // optional env file
  }
}

const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("No DATABASE_URL or SUPABASE_DB_URL in env");
  process.exit(1);
}

async function main() {
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const col = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'income_register'
       AND column_name = 'sales_rep_id'`,
  );
  console.log("income_register.sales_rep_id column exists:", col.rowCount > 0);

  if (col.rowCount > 0) {
    const { rows } = await client.query<Record<string, number>>(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE sales_rep_id IS NOT NULL AND btrim(sales_rep_id) <> '')::int AS populated,
        count(*) FILTER (WHERE sales_rep_id IS NULL OR btrim(sales_rep_id) = '')::int AS missing,
        count(*) FILTER (WHERE entry_type = 'product_sale')::int AS product_sales,
        count(*) FILTER (WHERE entry_type = 'product_sale' AND invoice_no ILIKE 'POS%')::int AS pos_rows,
        count(*) FILTER (WHERE entry_type = 'product_sale' AND invoice_no ILIKE 'PSI%')::int AS psi_rows,
        count(*) FILTER (
          WHERE entry_type = 'product_sale'
            AND sales_rep_id IS NOT NULL
            AND btrim(sales_rep_id) <> ''
        )::int AS product_sales_with_rep
      FROM income_register
    `);
    console.log("income_register stats:", rows[0]);

    const samples = await client.query<{ invoice_no: string | null; sales_rep_id: string | null }>(
      `SELECT invoice_no, sales_rep_id
       FROM income_register
       WHERE entry_type = 'product_sale'
       ORDER BY date DESC
       LIMIT 8`,
    );
    console.log("sample product_sale invoice_no values:", samples.rows);
  }

  const qCol = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'client_quotations'
       AND column_name IN (
         'sales_rep_id', 'assigned_to', 'created_by',
         'opportunity_id', 'authorized_by_name'
       )
     ORDER BY 1`,
  );
  console.log(
    "client_quotations rep-related columns:",
    qCol.rows.map((r) => r.column_name),
  );

  const qStats = await client.query<Record<string, number>>(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE opportunity_id IS NOT NULL)::int AS with_opportunity,
      count(*) FILTER (
        WHERE authorized_by_name IS NOT NULL AND btrim(authorized_by_name) <> ''
      )::int AS with_authorized_by_name
    FROM client_quotations
  `);
  console.log("client_quotations stats:", qStats.rows[0]);

  const ua = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'user_accounts'
       AND column_name IN ('auth_uid', 'employee_id', 'role')
     ORDER BY 1`,
  );
  console.log(
    "user_accounts mapping columns:",
    ua.rows.map((r) => r.column_name),
  );

  const sr = await client.query<Record<string, number>>(`
    SELECT
      count(*)::int AS sales_rep_accounts,
      count(*) FILTER (
        WHERE employee_id IS NOT NULL AND btrim(employee_id) <> ''
      )::int AS with_employee_id
    FROM user_accounts
    WHERE role = 'sales_rep'
  `);
  console.log("sales_rep user_accounts:", sr.rows[0]);

  const ciCol = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'client_invoices'
       AND column_name = 'sales_rep_id'`,
  );
  console.log("client_invoices.sales_rep_id column exists:", ciCol.rowCount > 0);
  if (ciCol.rowCount > 0) {
    const ciStats = await client.query<Record<string, number>>(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (
          WHERE sales_rep_id IS NOT NULL AND btrim(sales_rep_id) <> ''
        )::int AS populated
      FROM client_invoices
    `);
    console.log("client_invoices stats:", ciStats.rows[0]);
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
