import { connectPg } from "../lib/pg-connect";

async function main() {
  const { client } = await connectPg({
    requiredProjectRef: "tvcurcnmasnocwdxzgvz",
    envFiles: [".env.local.production-backup-2026-08-25"],
  });
  const tid = (
    await client.query(`SELECT id FROM tenants WHERE name ILIKE '%Nextronics%' LIMIT 1`)
  ).rows[0].id;
  const r = await client.query(
    `SELECT fp.product_code, fpb.business_unit_id, fpb.current_stock,
      fpb.average_cost_per_unit AS stored,
      public.finished_product_weighted_avg_cost_scoped(fpb.product_id, fpb.business_unit_id) AS formula,
      round(fpb.current_stock * fpb.average_cost_per_unit, 2) AS val_stored,
      round(fpb.current_stock * coalesce(public.finished_product_weighted_avg_cost_scoped(fpb.product_id, fpb.business_unit_id),0), 2) AS val_formula
     FROM finished_product_balances fpb
     JOIN finished_products fp ON fp.id = fpb.product_id
     WHERE fpb.tenant_id = $1::uuid AND coalesce(fpb.current_stock,0) > 0
     ORDER BY abs(
       round(fpb.current_stock * fpb.average_cost_per_unit, 2)
       - round(fpb.current_stock * coalesce(public.finished_product_weighted_avg_cost_scoped(fpb.product_id, fpb.business_unit_id),0), 2)
     ) DESC NULLS LAST
     LIMIT 20`,
    [tid],
  );
  console.log(JSON.stringify(r.rows, null, 2));
  const sum = await client.query(
    `SELECT round(sum(
       round(fpb.current_stock*fpb.average_cost_per_unit,2)
       - round(fpb.current_stock*coalesce(public.finished_product_weighted_avg_cost_scoped(fpb.product_id, fpb.business_unit_id),0),2)
     ),2) AS total_drift
     FROM finished_product_balances fpb WHERE fpb.tenant_id = $1::uuid`,
    [tid],
  );
  console.log("total_drift", sum.rows[0]);
  await client.end();
}

main();
