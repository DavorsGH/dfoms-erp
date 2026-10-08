/**
 * Read-only: product sales that have return credit notes AND sale_status voided.
 *   npx tsx scripts/probe-returned-and-voided-sales-production-readonly.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

function loadEnv(f: string) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function main() {
  const STAGING_REF = "wieflwbfdmjtsdnwbfii";
  let envFileUsed: string | null = null;
  for (const envFile of [".env.local.backup", ".env.vercel.production.local"]) {
    loadEnv(resolve(envFile));
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    if (!url || url.includes(STAGING_REF)) {
      continue;
    }
    envFileUsed = envFile;
    break;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url || url.includes(STAGING_REF) || !envFileUsed) {
    throw new Error(
      "Production Supabase URL required (.env.local.backup or .env.vercel.production.local, not staging)",
    );
  }

  const { client } = await connectPg({ envFiles: [envFileUsed] });

  const { rows } = await client.query(`
    WITH returned_lines AS (
      SELECT
        li.source_income_register_id AS income_id,
        SUM(li.quantity)::numeric(18, 4) AS returned_qty
      FROM credit_note_line_items li
      GROUP BY li.source_income_register_id
    )
    SELECT
      t.name AS tenant_name,
      i.tenant_id,
      i.id AS income_id,
      i.invoice_no,
      i.date AS sale_date,
      i.sale_quantity,
      COALESCE(rl.returned_qty, 0) AS returned_qty,
      i.amount AS sale_amount,
      i.sale_status,
      i.voided_at,
      i.cogs_expense_id,
      i.cogs_reversal_expense_id,
      fp.product_code,
      fp.product_name,
      (
        SELECT COUNT(*)::int
        FROM stock_movements sm
        WHERE sm.reference_id = i.id
          AND sm.notes ILIKE '%voided sale%'
      ) AS void_restock_movements,
      (
        SELECT COUNT(*)::int
        FROM stock_movements sm
        WHERE sm.reference_id = i.id
          AND sm.notes ILIKE '%Return restock%'
      ) AS return_restock_movements
    FROM income_register i
    JOIN tenants t ON t.id = i.tenant_id
    LEFT JOIN returned_lines rl ON rl.income_id = i.id
    LEFT JOIN finished_products fp ON fp.id = i.product_id
    WHERE i.entry_type = 'product_sale'
      AND i.is_sale_return IS NOT TRUE
      AND i.sale_status = 'voided'
      AND COALESCE(rl.returned_qty, 0) > 0
    ORDER BY t.name, i.invoice_no;
  `);

  console.log(JSON.stringify({ count: rows.length, rows }, null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
