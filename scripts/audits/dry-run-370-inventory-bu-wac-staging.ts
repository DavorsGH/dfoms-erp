/**
 * Dry-run migration 370: NULL BU balances, WAC drift, merge plan.
 * npx tsx scripts/audits/dry-run-370-inventory-bu-wac-staging.ts
 */
import { connectPg } from "../lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`Dry-run 370 inventory (${envFile})\n`);

  console.log("=== NULL BU finished_product_balances (stock > 0) ===");
  const nullFp = await client.query(`
    SELECT t.name AS tenant_name, fp.product_code, fpb.id AS balance_id,
      fpb.current_stock, fpb.average_cost_per_unit,
      (
        SELECT bu.id FROM public.business_units bu
        WHERE bu.tenant_id = fpb.tenant_id
        ORDER BY bu.created_at NULLS LAST, bu.name LIMIT 1
      ) AS primary_bu_id,
      (
        SELECT bu.name FROM public.business_units bu
        WHERE bu.tenant_id = fpb.tenant_id
        ORDER BY bu.created_at NULLS LAST, bu.name LIMIT 1
      ) AS primary_bu_name,
      EXISTS (
        SELECT 1 FROM public.finished_product_balances f2
        WHERE f2.tenant_id = fpb.tenant_id
          AND f2.product_id = fpb.product_id
          AND f2.business_unit_id = (
            SELECT bu.id FROM public.business_units bu
            WHERE bu.tenant_id = fpb.tenant_id
            ORDER BY bu.created_at NULLS LAST, bu.name LIMIT 1
          )
      ) AS merge_into_primary_exists
    FROM public.finished_product_balances fpb
    JOIN public.tenants t ON t.id = fpb.tenant_id
    JOIN public.finished_products fp ON fp.id = fpb.product_id
    WHERE fpb.business_unit_id IS NULL
      AND coalesce(fpb.current_stock, 0) <> 0
    ORDER BY t.name, fp.product_code
  `);
  for (const row of nullFp.rows) {
    console.log(row);
  }

  console.log("\n=== NULL BU raw_material_balances (stock > 0) ===");
  const nullRm = await client.query(`
    SELECT t.name AS tenant_name, rm.material_code, rmb.id AS balance_id,
      rmb.current_stock, rmb.average_cost_per_unit
    FROM public.raw_material_balances rmb
    JOIN public.tenants t ON t.id = rmb.tenant_id
    JOIN public.raw_materials rm ON rm.id = rmb.material_id
    WHERE rmb.business_unit_id IS NULL
      AND coalesce(rmb.current_stock, 0) <> 0
    ORDER BY t.name, rm.material_code
  `);
  for (const row of nullRm.rows) {
    console.log(row);
  }

  console.log("\n=== FP WAC drift (|stored - formula| > 0.01, stock > 0) ===");
  const fpDrift = await client.query(`
    SELECT t.name AS tenant_name, bu.name AS bu_name, fp.product_code,
      fpb.current_stock,
      fpb.average_cost_per_unit AS stored_wac,
      public.finished_product_weighted_avg_cost_scoped(fp.id, fpb.business_unit_id) AS formula_wac
    FROM public.finished_product_balances fpb
    JOIN public.finished_products fp ON fp.id = fpb.product_id
    JOIN public.tenants t ON t.id = fpb.tenant_id
    LEFT JOIN public.business_units bu ON bu.id = fpb.business_unit_id
    WHERE fpb.current_stock > 0
      AND abs(
        coalesce(fpb.average_cost_per_unit, 0)
        - coalesce(public.finished_product_weighted_avg_cost_scoped(fp.id, fpb.business_unit_id), 0)
      ) > 0.01
    ORDER BY t.name, fp.product_code
  `);
  for (const row of fpDrift.rows) {
    console.log(row);
  }

  console.log("\n=== RM rows with negative WAC and stock > 0 ===");
  const rmNeg = await client.query(`
    SELECT t.name, rm.material_code, rmb.business_unit_id, rmb.current_stock, rmb.average_cost_per_unit
    FROM public.raw_material_balances rmb
    JOIN public.raw_materials rm ON rm.id = rmb.material_id
    JOIN public.tenants t ON t.id = rmb.tenant_id
    WHERE rmb.current_stock > 0 AND coalesce(rmb.average_cost_per_unit, 0) < 0
  `);
  for (const row of rmNeg.rows) {
    console.log(row);
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
