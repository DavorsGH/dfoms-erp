import { connectPg } from "../lib/pg-connect";

async function main() {
  const { client } = await connectPg({
    requiredProjectRef: "tvcurcnmasnocwdxzgvz",
    envFiles: [".env.local.production-backup-2026-08-25"],
  });
  const tid = (
    await client.query(`SELECT id FROM tenants WHERE name ILIKE '%Nextronics%' LIMIT 1`)
  ).rows[0].id;

  const sales = await client.query(
    `SELECT ir.id, ir.invoice_no, ir.date::date, ir.amount, ir.sale_quantity, ir.business_unit_id,
      er.amount AS cogs_amount, er.price AS cogs_unit, fp.product_code,
      public.finished_product_weighted_avg_cost_scoped(ir.product_id, ir.business_unit_id) AS wac_at_sale_bu
     FROM income_register ir
     LEFT JOIN expense_register er ON er.id = ir.cogs_expense_id
     LEFT JOIN finished_products fp ON fp.id = ir.product_id
     WHERE ir.tenant_id = $1::uuid
       AND ir.entry_type = 'product_sale'
       AND ir.date >= '2026-10-01' AND ir.date < '2026-11-01'
     ORDER BY ir.date`,
    [tid],
  );

  let mismatch = 0;
  for (const row of sales.rows) {
    const qty = Number(row.sale_quantity) || 0;
    const cogs = Number(row.cogs_amount) || 0;
    const wac = Number(row.wac_at_sale_bu) || 0;
    const expected = Math.round(qty * wac * 100) / 100;
    const delta = Math.round((cogs - expected) * 100) / 100;
    if (Math.abs(delta) > 0.01) {
      mismatch += delta;
      console.log({ ...row, expected_cogs: expected, cogs_minus_expected: delta });
    }
  }
  console.log("\nSum (booked COGS - WAC*qty) for Oct sales:", mismatch);
  await client.end();
}

main();
