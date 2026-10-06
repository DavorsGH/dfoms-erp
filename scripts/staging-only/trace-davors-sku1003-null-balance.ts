/**
 * Staging-only: trace NULL BU balance row for SKU-1003 before delete/reassign.
 * npx tsx scripts/staging-only/trace-davors-sku1003-null-balance.ts
 */
import { connectPg } from "../lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TENANT = "00000001-0000-4000-8000-000000000001";
const BALANCE_ID = "20bf5a59-eb84-463b-b0c5-6511139f8805";
const PRODUCT_ID = "c64bcd91-8717-40bd-9140-08f5bf2b1433";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`Trace SKU-1003 NULL balance (${envFile}, staging only)\n`);

  const bal = await client.query(
    `SELECT * FROM public.finished_product_balances WHERE id = $1::uuid`,
    [BALANCE_ID],
  );
  console.log("balance row:", bal.rows[0]);

  const adj = await client.query(
    `
    SELECT id, adjustment_type, quantity_delta, cost_per_unit,
           created_at, business_unit_id, notes
    FROM public.finished_product_stock_adjustments
    WHERE tenant_id = $1::uuid AND product_id = $2::uuid
    ORDER BY created_at
    `,
    [TENANT, PRODUCT_ID],
  );
  console.log("\nall FP adjustments for SKU-1003:", adj.rows);

  const nullAdj = await client.query(
    `
    SELECT id, adjustment_type, quantity_delta, cost_per_unit, created_at, business_unit_id
    FROM public.finished_product_stock_adjustments
    WHERE tenant_id = $1::uuid AND product_id = $2::uuid
      AND business_unit_id IS NULL
    `,
    [TENANT, PRODUCT_ID],
  );
  console.log("\nNULL BU adjustments:", nullAdj.rows);

  const links = await client.query(
    `
    SELECT l.source_kind, l.adjustment_id, l.created_at
    FROM public.inventory_stock_adjustment_register_links l
    JOIN public.finished_product_stock_adjustments a ON a.id = l.adjustment_id
    WHERE l.tenant_id = $1::uuid AND a.product_id = $2::uuid
    `,
    [TENANT, PRODUCT_ID],
  );
  console.log("\nregister links:", links.rows);

  const bulk = await client.query(
    `
    SELECT j.id, j.module_key, j.status, j.created_at, j.created_by
    FROM public.bulk_import_jobs j
    WHERE j.tenant_id = $1::uuid
      AND j.created_at >= '2026-09-27'::timestamptz
      AND j.created_at < '2026-09-28'::timestamptz
    ORDER BY j.created_at
    `,
    [TENANT],
  );
  console.log("\nbulk_import_jobs on balance created_at day:", bulk.rows);

  const activity = await client.query(
    `
    SELECT event_name, status, created_at, metadata
    FROM public.user_activity_log
    WHERE tenant_id = $1::uuid
      AND created_at >= '2026-09-27'::timestamptz
      AND created_at < '2026-09-28'::timestamptz
      AND (
        metadata::text ILIKE '%SKU-1003%'
        OR metadata::text ILIKE $2
        OR metadata::text ILIKE $3
      )
    ORDER BY created_at
    LIMIT 20
    `,
    [TENANT, `%${PRODUCT_ID}%`, `%${BALANCE_ID}%`],
  );
  console.log("\nuser_activity_log (SKU-1003 day):", activity.rows);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
