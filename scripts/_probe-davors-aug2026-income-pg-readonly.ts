/**
 * READ-ONLY pg probe: August 2026 income + BS for Davors, find ~36.90 drivers.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

loadEnvForce(resolve(".env.local.backup"));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!supabaseUrl.includes("tvcurcnmasnocwdxzgvz")) {
  throw new Error("Expected production");
}

function rebuildUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  const password = decodeURIComponent(parsed.password);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

const candidates: string[] = [];
if (process.env.DATABASE_URL) {
  candidates.push(process.env.DATABASE_URL, rebuildUrl(process.env.DATABASE_URL));
}
if (process.env.SUPABASE_DB_PASSWORD && supabaseUrl) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0]!;
  const password = process.env.SUPABASE_DB_PASSWORD;
  candidates.push(
    `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
  );
}

const TENANT = "00000001-0000-4000-8000-000000000001";
const TODAY = "2026-08-21";

async function run(client: pg.Client) {
  console.log("\n=== Davors Facilities — August 2026 income (read-only) ===\n");

  const { rows: rev } = await client.query(
    `
    SELECT
      COUNT(*)::int AS row_count,
      ROUND(COALESCE(SUM(amount), 0)::numeric, 2) AS total_amount,
      ROUND(COALESCE(SUM(CASE WHEN sale_status IS DISTINCT FROM 'voided' THEN amount ELSE 0 END), 0)::numeric, 2) AS active_amount
    FROM income_register
    WHERE tenant_id = $1
      AND date >= '2026-08-01' AND date <= '2026-08-31'
    `,
    [TENANT],
  );
  console.log("August revenue totals:", rev[0]);

  const { rows: augIncome } = await client.query(
    `
    SELECT id, date, invoice_no, amount, amount_received, outstanding_balance,
           payment_status, service_category, entry_type, sale_status, voided_at,
           is_system_adjustment, net_of_tax_amount, output_vat_amount, wht_amount,
           output_tax_component, tax_inclusive, customer_name, description, notes,
           client_invoice_id
    FROM income_register
    WHERE tenant_id = $1
      AND date >= '2026-08-01' AND date <= '2026-08-31'
    ORDER BY date DESC, invoice_no
    `,
    [TENANT],
  );
  console.log(`\nAll August income rows (${augIncome.length}):`);
  console.table(augIncome);

  const { rows: amt369 } = await client.query(
    `
    SELECT * FROM income_register
    WHERE tenant_id = $1
      AND (
        ROUND(amount::numeric, 2) IN (36.90, 13.84)
        OR ROUND(outstanding_balance::numeric, 2) IN (36.90, 13.84)
        OR ROUND(COALESCE(output_vat_amount,0)::numeric, 2) = 36.90
      )
    ORDER BY date DESC
    `,
    [TENANT],
  );
  console.log("\nRows with amount/outstanding/tax ≈ 36.90 or 13.84:");
  console.table(amt369);

  const { rows: voidedToday } = await client.query(
    `
    SELECT id, date, invoice_no, amount, voided_at, sale_status
    FROM income_register
    WHERE tenant_id = $1
      AND voided_at::date = $2::date
    `,
    [TENANT, TODAY],
  );
  console.log("\nVoided today:", voidedToday);

  const { rows: taxToday } = await client.query(
    `
    SELECT t.*, i.invoice_no, i.date AS income_date, i.amount AS income_amount
    FROM tax_ledger_entries t
    LEFT JOIN income_register i ON i.id = t.source_id AND t.source_table = 'income_register'
    WHERE t.tenant_id = $1
      AND t.source_table = 'income_register'
      AND (
        t.created_at::date = $2::date
        OR (t.updated_at IS NOT NULL AND t.updated_at::date = $2::date)
      )
    ORDER BY t.created_at DESC
    `,
    [TENANT, TODAY],
  );
  console.log("\nTax ledger income links created/updated today:");
  console.table(taxToday);

  const { rows: invToday } = await client.query(
    `
    SELECT ci.id, ci.invoice_number, ci.invoice_date, ci.subtotal, ci.total_amount_due,
           ci.updated_at, ci.created_at, ir.id AS income_id, ir.amount, ir.outstanding_balance,
           ir.is_system_adjustment
    FROM client_invoices ci
    LEFT JOIN income_register ir ON ir.client_invoice_id = ci.id
    WHERE ci.tenant_id = $1
      AND (
        ci.updated_at::date = $2::date
        OR ci.created_at::date = $2::date
      )
      AND ci.invoice_date >= '2026-08-01' AND ci.invoice_date <= '2026-08-31'
    ORDER BY ci.updated_at DESC
    `,
    [TENANT, TODAY],
  );
  console.log("\nClient invoices Aug 2026 touched today:");
  console.table(invToday);

  const { rows: sysAdjBad } = await client.query(
    `
    SELECT id, date, invoice_no, amount, outstanding_balance, output_vat_amount, wht_amount,
           is_system_adjustment, payment_status, amount_received, notes
    FROM income_register
    WHERE tenant_id = $1
      AND (
        (is_system_adjustment = true AND (COALESCE(outstanding_balance,0) <> 0 OR COALESCE(output_vat_amount,0) <> 0 OR COALESCE(wht_amount,0) <> 0))
        OR (is_system_adjustment = false AND service_category ILIKE '%other%' AND COALESCE(outstanding_balance,0) > 0 AND COALESCE(amount_received,0) = 0)
      )
    ORDER BY date DESC
    LIMIT 20
    `,
    [TENANT],
  );
  console.log("\nMis-shaped system adjustment / suspicious other income:");
  console.table(sysAdjBad);

  const { rows: tenantRev } = await client.query(
    `
    SELECT t.name,
           ROUND(COALESCE(SUM(CASE WHEN ir.sale_status IS DISTINCT FROM 'voided' THEN ir.amount ELSE 0 END), 0)::numeric, 2) AS aug_revenue
    FROM tenants t
    LEFT JOIN income_register ir ON ir.tenant_id = t.id
      AND ir.date >= '2026-08-01' AND ir.date <= '2026-08-31'
    GROUP BY t.id, t.name
    HAVING ROUND(COALESCE(SUM(CASE WHEN ir.sale_status IS DISTINCT FROM 'voided' THEN ir.amount ELSE 0 END), 0)::numeric, 2)
      IN (647.50, 684.40, 633.66, 670.56)
    ORDER BY t.name
    `,
  );
  console.log("\nTenants with Aug revenue matching observed figures:");
  console.table(tenantRev);

  const { rows: allRevNear } = await client.query(
    `
    SELECT t.name,
           ROUND(COALESCE(SUM(CASE WHEN ir.sale_status IS DISTINCT FROM 'voided' THEN ir.amount ELSE 0 END), 0)::numeric, 2) AS aug_revenue
    FROM tenants t
    LEFT JOIN income_register ir ON ir.tenant_id = t.id
      AND ir.date >= '2026-08-01' AND ir.date <= '2026-08-31'
    GROUP BY t.id, t.name
    ORDER BY aug_revenue DESC
    `,
  );
  console.log("\nAll tenants August 2026 revenue:");
  console.table(allRevNear);
}

async function main() {
  let lastError: unknown;
  for (const connectionString of [...new Set(candidates)]) {
    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await client.connect();
      await run(client);
      await client.end();
      return;
    } catch (e) {
      lastError = e;
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  throw lastError ?? new Error("No DB connection");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
