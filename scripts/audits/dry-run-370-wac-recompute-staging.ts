/**
 * Dry-run revised 370: WAC recompute candidates only (no NULL→primary merge).
 * npx tsx scripts/audits/dry-run-370-wac-recompute-staging.ts
 */
import { connectPg } from "../lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`370 WAC recompute dry-run staging (${envFile})\n`);

  const { rows } = await client.query(`
    SELECT t.name AS tenant_name,
      bu.name AS bu_name,
      fp.product_code,
      fpb.id AS balance_id,
      fpb.business_unit_id,
      fpb.current_stock,
      fpb.average_cost_per_unit AS stored_wac,
      round(
        greatest(
          coalesce(
            public.finished_product_weighted_avg_cost_scoped(fpb.product_id, fpb.business_unit_id),
            0
          ),
          0
        ),
        4
      ) AS new_wac
    FROM public.finished_product_balances fpb
    JOIN public.finished_products fp ON fp.id = fpb.product_id
    JOIN public.tenants t ON t.id = fpb.tenant_id
    LEFT JOIN public.business_units bu ON bu.id = fpb.business_unit_id
    WHERE fpb.current_stock > 0
      AND abs(
        coalesce(fpb.average_cost_per_unit, 0)
        - coalesce(
          public.finished_product_weighted_avg_cost_scoped(fpb.product_id, fpb.business_unit_id),
          0
        )
      ) > 0.01
    ORDER BY t.name, fp.product_code, bu.name NULLS FIRST
  `);

  console.log(`Rows that would change: ${rows.length}\n`);
  for (const row of rows) {
    console.log(row);
  }
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
