/**
 * Dry-run: historical zero-COGS product sales → proposed BU-scoped WAC repair.
 * npx tsx scripts/audits/dry-run-zero-cogs-historical-repair-staging.ts
 */
import { connectPg } from "../lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

const DRY_RUN_SQL = `
WITH sale_rows AS (
  SELECT
    t.name AS tenant_name,
    bu.name AS business_unit_name,
    ir.id AS income_id,
    ir.invoice_no,
    ir.date::date AS sale_date,
    fp.product_code,
    ir.product_id,
    ir.business_unit_id,
    coalesce(ir.sale_quantity, 0) AS qty,
    ir.cogs_expense_id,
    coalesce(er.amount, 0) AS booked_cogs,
    coalesce(er.price, 0) AS booked_unit_price
  FROM public.income_register ir
  JOIN public.tenants t ON t.id = ir.tenant_id
  LEFT JOIN public.business_units bu ON bu.id = ir.business_unit_id
  LEFT JOIN public.expense_register er ON er.id = ir.cogs_expense_id
  LEFT JOIN public.finished_products fp ON fp.id = ir.product_id
  WHERE ir.entry_type = 'product_sale'
    AND coalesce(ir.sale_status, 'active') <> 'voided'
    AND coalesce(ir.is_sale_return, false) = false
    AND coalesce(ir.sale_quantity, 0) > 0
    AND (
      ir.cogs_expense_id IS NULL
      OR abs(coalesce(er.amount, 0)) < 0.0001
    )
)
SELECT
  tenant_name,
  coalesce(business_unit_name, '(null BU)') AS business_unit_name,
  invoice_no,
  sale_date,
  product_code,
  qty,
  booked_cogs,
  round(
    greatest(
      coalesce(
        nullif(
          public.finished_product_weighted_avg_cost_scoped(product_id, business_unit_id),
          0
        ),
        0
      ),
      coalesce(public.finished_product_weighted_avg_cost(product_id), 0),
      0
    ),
    4
  ) AS proposed_unit_cost,
  round(
    qty * greatest(
      coalesce(
        nullif(
          public.finished_product_weighted_avg_cost_scoped(product_id, business_unit_id),
          0
        ),
        0
      ),
      coalesce(public.finished_product_weighted_avg_cost(product_id), 0),
      0
    ),
    2
  ) AS proposed_cogs_amount,
  CASE WHEN cogs_expense_id IS NULL THEN 'missing_expense' ELSE 'zero_amount' END AS repair_kind
FROM sale_rows
ORDER BY tenant_name, sale_date, invoice_no;
`;

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`Dry-run zero-COGS historical repair (${envFile})\n`);
  const { rows } = await client.query(DRY_RUN_SQL);
  console.log(`Rows: ${rows.length}\n`);
  for (const row of rows) {
    console.log(
      [
        row.tenant_name,
        row.business_unit_name,
        row.invoice_no,
        row.sale_date,
        row.product_code,
        `qty=${row.qty}`,
        `proposed=${row.proposed_unit_cost}`,
        `cogs=${row.proposed_cogs_amount}`,
        row.repair_kind,
      ].join("\t"),
    );
  }
  const davors = rows.filter(
    (r: { tenant_name: string }) => r.tenant_name === "Davors",
  );
  console.log(`\nDavors total lines: ${davors.length}`);
  console.log(
    `Davors proposed COGS sum: ${davors.reduce(
      (s: number, r: { proposed_cogs_amount: string }) =>
        s + Number(r.proposed_cogs_amount),
      0,
    ).toFixed(2)}`,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
