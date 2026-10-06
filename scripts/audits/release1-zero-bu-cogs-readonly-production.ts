/**
 * Read-only: confirm 369-style COGS fallback (tenant-wide WAC) for zero-BU tenants on prod DB.
 * Uses same logic as create_product_sale path: scoped then tenant-wide if scoped <= 0.
 * npx tsx scripts/audits/release1-zero-bu-cogs-readonly-production.ts
 */
import { connectPg } from "../lib/pg-connect";

const PROD_REF = "tvcurcnmasnocwdxzgvz";

async function main() {
  const { client } = await connectPg({
    requiredProjectRef: PROD_REF,
    envFiles: [".env.local.production-backup-2026-08-25"],
  });

  const { rows: zeroBu } = await client.query(
    `SELECT t.id, t.name FROM tenants t
     WHERE NOT EXISTS (SELECT 1 FROM business_units bu WHERE bu.tenant_id = t.id)
     ORDER BY t.name`,
  );

  console.log(`Zero-BU tenants: ${zeroBu.length}\n`);

  for (const t of zeroBu) {
    const { rows: atRisk } = await client.query(
      `SELECT fp.product_code, fpb.current_stock,
        public.finished_product_weighted_avg_cost_scoped(fp.id, NULL) AS scoped,
        public.finished_product_weighted_avg_cost(fp.id) AS tenant_wide,
        CASE
          WHEN coalesce(public.finished_product_weighted_avg_cost_scoped(fp.id, NULL), 0) <= 0
            THEN coalesce(public.finished_product_weighted_avg_cost(fp.id), 0)
          ELSE coalesce(public.finished_product_weighted_avg_cost_scoped(fp.id, NULL), 0)
        END AS sale_unit_cost_369_logic
       FROM finished_products fp
       JOIN finished_product_balances fpb ON fpb.product_id = fp.id AND fpb.business_unit_id IS NULL
       WHERE fp.tenant_id = $1 AND fpb.current_stock > 0`,
      [t.id],
    );
    const zeroCostWithStock = atRisk.filter(
      (r) => Number(r.sale_unit_cost_369_logic) <= 0 && Number(r.current_stock) > 0,
    );
    console.log(`${t.name}: SKUs with stock=${atRisk.length}, would book zero COGS=${zeroCostWithStock.length}`);
    if (zeroCostWithStock.length > 0) {
      console.log("  ", zeroCostWithStock.slice(0, 5));
    }
  }

  const { rows: recentZeroCogs } = await client.query(
    `SELECT t.name, count(*)::int AS n
     FROM income_register i
     JOIN tenants t ON t.id = i.tenant_id
     LEFT JOIN expense_register e ON e.id = i.cogs_expense_id
     WHERE NOT EXISTS (SELECT 1 FROM business_units bu WHERE bu.tenant_id = t.id)
       AND i.entry_type = 'product_sale' AND coalesce(i.sale_status::text, 'active') <> 'voided'
       AND coalesce(e.amount,0) = 0 AND coalesce(i.sale_quantity,0) > 0
     GROUP BY t.name`,
  );
  console.log("\nHistorical zero-COGS sales (zero-BU tenants):", recentZeroCogs);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
