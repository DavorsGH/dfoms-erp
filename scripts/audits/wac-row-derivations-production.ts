/**
 * Read-only: full WAC derivation for the 6 production 370 candidate rows.
 * npx tsx scripts/audits/wac-row-derivations-production.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "../lib/pg-connect";

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const OUT = resolve(
  process.cwd(),
  "scripts/audits/output/wac-row-derivations-production.json",
);

const TARGETS = [
  { tenant: "Caanta Market", product: "CAANT-FP-0001" },
  { tenant: "Mimshack-Glo-Ltd", product: "MIMSH-FP-0001" },
  { tenant: "Nextronics World", product: "NEXTR-FP-0007" },
  { tenant: "Nextronics World", product: "NEXTR-FP-0015" },
  { tenant: "Nextronics World", product: "NEXTR-FP-0017" },
  { tenant: "Nextronics World", product: "NEXTR-FP-0044" },
];

async function main() {
  const { client } = await connectPg({
    requiredProjectRef: PROD_REF,
    envFiles: [".env.local.production-backup-2026-08-25"],
  });

  const reports: unknown[] = [];

  for (const target of TARGETS) {
    const { rows: prodRows } = await client.query(
      `SELECT fp.id AS product_id, fp.tenant_id, t.name AS tenant_name,
        (SELECT count(*)::int FROM business_units bu WHERE bu.tenant_id = fp.tenant_id) AS bu_count
       FROM finished_products fp
       JOIN tenants t ON t.id = fp.tenant_id
       WHERE t.name = $1 AND fp.product_code = $2`,
      [target.tenant, target.product],
    );
    if (!prodRows[0]) continue;
    const { product_id, tenant_id, bu_count } = prodRows[0] as {
      product_id: string;
      tenant_id: string;
      bu_count: number;
    };

    const buId = null;
    const { rows: bal } = await client.query(
      `SELECT current_stock, average_cost_per_unit FROM finished_product_balances
       WHERE product_id = $1 AND business_unit_id IS NOT DISTINCT FROM $2`,
      [product_id, buId],
    );

    const purchases = (
      await client.query(
        `SELECT purchase_date, quantity, cost_per_unit, total_cost, notes, remaining_quantity
         FROM product_purchases WHERE product_id = $1
           AND business_unit_id IS NOT DISTINCT FROM $2 ORDER BY purchase_date, created_at`,
        [product_id, buId],
      )
    ).rows;

    const batches = (
      await client.query(
        `SELECT production_date, quantity_produced, total_batch_cost, batch_number
         FROM production_batches WHERE finished_product_id = $1
           AND business_unit_id IS NOT DISTINCT FROM $2 ORDER BY production_date`,
        [product_id, buId],
      )
    ).rows;

    const sales = (
      await client.query(
        `SELECT i.date, i.invoice_no, i.sale_quantity, e.amount AS cogs_amount
         FROM income_register i
         LEFT JOIN expense_register e ON e.id = i.cogs_expense_id
         WHERE i.product_id = $1 AND i.entry_type = 'product_sale'
           AND i.business_unit_id IS NOT DISTINCT FROM $2
         ORDER BY i.date`,
        [product_id, buId],
      )
    ).rows;

    const ic = (
      await client.query(
        `SELECT ic.consumption_date, e.amount
         FROM internal_consumption ic
         JOIN expense_register e ON e.id = ic.expense_register_id
         WHERE ic.product_id = $1 AND ic.business_unit_id IS NOT DISTINCT FROM $2`,
        [product_id, buId],
      )
    ).rows;

    const adj = (
      await client.query(
        `SELECT created_at::date AS d, adjustment_type, quantity_delta, cost_per_unit,
                quantity_delta * cost_per_unit AS value
         FROM finished_product_stock_adjustments
         WHERE product_id = $1 AND business_unit_id IS NOT DISTINCT FROM $2
         ORDER BY created_at`,
        [product_id, buId],
      )
    ).rows;

    const returns = (
      await client.query(
        `SELECT cn.credit_note_date, cnli.quantity, cnli.unit_price
         FROM credit_note_line_items cnli
         JOIN credit_notes cn ON cn.id = cnli.credit_note_id
         WHERE cnli.product_id = $1`,
        [product_id],
      )
    ).rows;

    const { rows: wacRows } = await client.query(
      `SELECT
        public.finished_product_weighted_avg_cost($1::uuid) AS tenant_wide_wac,
        public.finished_product_weighted_avg_cost_scoped($1::uuid, $2::uuid) AS scoped_wac`,
      [product_id, buId],
    );

    const sumIn =
      batches.reduce((s, r) => s + Number(r.total_batch_cost), 0) +
      purchases.reduce((s, r) => s + Number(r.total_cost), 0) +
      adj.reduce((s, r) => s + Number(r.value), 0);
    const sumOut =
      sales.reduce((s, r) => s + Number(r.cogs_amount), 0) +
      ic.reduce((s, r) => s + Number(r.amount), 0);
    const stock = Number(bal[0]?.current_stock) || 0;
    const manualFormula =
      stock > 0 ? Math.max(0, sumIn - sumOut) / stock : null;

    reports.push({
      tenant: target.tenant,
      product_code: target.product,
      product_id,
      tenant_id,
      bu_count,
      business_unit: bu_count === 0 ? "whole business (NULL BU)" : "NULL BU slice",
      balance: bal[0] ?? null,
      stored_wac: Number(bal[0]?.average_cost_per_unit) || 0,
      tenant_wide_wac: Number(wacRows[0]?.tenant_wide_wac) || 0,
      scoped_wac_current_db: Number(wacRows[0]?.scoped_wac) || 0,
      manual_numerator: sumIn - sumOut,
      manual_wac_from_ledger: manualFormula,
      purchases,
      production_batches: batches,
      product_sales_cogs: sales,
      internal_consumption: ic,
      stock_adjustments: adj,
      credit_note_lines: returns,
      halving_note:
        manualFormula !== null &&
        stock > 0 &&
        Math.abs(Number(bal[0]?.average_cost_per_unit) - manualFormula * 2) < 0.01
          ? "Stored WAC ≈ 2× manual ledger WAC — check opening_balance + zero-cost product_purchase lot row (363) or stale balance WAC."
          : null,
    });
  }

  mkdirSync(resolve(process.cwd(), "scripts/audits/output"), { recursive: true });
  writeFileSync(OUT, JSON.stringify(reports, null, 2));
  console.log(`Wrote ${reports.length} reports → ${OUT}`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
