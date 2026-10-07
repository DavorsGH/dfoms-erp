/**
 * Read-only staging: SKU-1003 WAC + latest IC expense path (Facilities BU).
 * npx tsx scripts/audits/readonly-staging-ic-sku1003-wac-diagnosis.ts
 */
import { connectPg } from "../lib/pg-connect";

const TENANT = "00000001-0000-4000-8000-000000000001";
const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`Connected via ${envFile}\n`);

  const ids = await client.query<{
    product_id: string;
    bu_id: string;
    bu_name: string;
  }>(
    `
    SELECT fp.id AS product_id, bu.id AS bu_id, bu.name AS bu_name
    FROM finished_products fp
    CROSS JOIN business_units bu
    WHERE fp.tenant_id = $1
      AND fp.product_code = 'SKU-1003'
      AND bu.tenant_id = $1
      AND bu.name ILIKE '%Facilities%'
    LIMIT 1
  `,
    [TENANT],
  );

  const row = ids.rows[0];
  if (!row) {
    console.log("SKU-1003 or Facilities BU not found");
    await client.end();
    return;
  }

  const wac = await client.query(
    `
    SELECT
      public.finished_product_weighted_avg_cost_scoped($1::uuid, $2::uuid) AS scoped_facilities_wac,
      public.finished_product_weighted_avg_cost($1::uuid) AS tenant_wide_wac,
      public.finished_product_inventory_outflow_unit_cost($1::uuid, $2::uuid) AS outflow_facilities_bu,
      public.finished_product_inventory_outflow_unit_cost($1::uuid, NULL::uuid) AS outflow_null_bu
  `,
    [row.product_id, row.bu_id],
  );

  console.log("1a) WAC / outflow (SKU-1003, Davors Facilities):");
  console.log(wac.rows[0]);

  const recent = await client.query(
    `
    SELECT ic.id, ic.quantity, ic.consumption_date, ic.business_unit_id, bu.name AS bu_name,
           ic.expense_register_id, ic.created_at, ic.reason,
           er.amount, er.quantity AS exp_qty, er.price AS exp_unit_price,
           er.description, er.sub_category
    FROM internal_consumption ic
    LEFT JOIN business_units bu ON bu.id = ic.business_unit_id
    LEFT JOIN expense_register er ON er.id = ic.expense_register_id
    WHERE ic.tenant_id = $1 AND ic.product_id = $2
    ORDER BY ic.created_at DESC
    LIMIT 8
  `,
    [TENANT, row.product_id],
  );

  console.log("\n1b) Recent IC rows + expense amounts:");
  console.table(recent.rows);

  const activity = await client.query(
    `
    SELECT created_at, event_name, status, metadata
    FROM user_activity_log
    WHERE tenant_id = $1
      AND event_name ILIKE '%internal_consumption%'
    ORDER BY created_at DESC
    LIMIT 12
  `,
    [TENANT],
  );

  console.log("\nRecent internal_consumption activity log:");
  console.table(activity.rows);

  const triggerBody = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'apply_internal_consumption'
    LIMIT 1
  `);

  const def = String(triggerBody.rows[0]?.def ?? "");
  const usesOutflow = def.includes("finished_product_inventory_outflow_unit_cost");
  const usesScopedOnly = def.includes("finished_product_weighted_avg_cost_scoped");
  const usesTenantWac = def.includes("finished_product_weighted_avg_cost(");

  console.log("\n1c) apply_internal_consumption on staging:");
  console.log({
    uses_finished_product_inventory_outflow_unit_cost: usesOutflow,
    uses_weighted_avg_cost_scoped: usesScopedOnly,
    uses_tenant_finished_product_weighted_avg_cost: usesTenantWac,
  });

  const nullBuIc = await client.query(
    `
    SELECT count(*)::int AS cnt
    FROM internal_consumption
    WHERE tenant_id = $1 AND product_id = $2 AND business_unit_id IS NULL
  `,
    [TENANT, row.product_id],
  );
  console.log("\nIC rows with NULL business_unit_id for SKU-1003:", nullBuIc.rows[0]);

  const balances = await client.query(
    `
    SELECT fp.product_code, fpb.business_unit_id, bu.name AS bu_name,
      fpb.current_stock,
      fpb.average_cost_per_unit AS stored_wac,
      public.finished_product_weighted_avg_cost_scoped(fp.id, fpb.business_unit_id) AS formula_wac
    FROM finished_product_balances fpb
    JOIN finished_products fp ON fp.id = fpb.product_id
    LEFT JOIN business_units bu ON bu.id = fpb.business_unit_id
    WHERE fp.tenant_id = $1 AND fp.product_code = 'SKU-1003'
  `,
    [TENANT],
  );
  console.log("\nSKU-1003 balance rows (stored vs formula WAC):");
  console.table(balances.rows);

  const directOp = await client.query(
    `
    SELECT er.sub_category, coalesce(sum(er.amount), 0)::numeric(18,2) AS total
    FROM expense_register er
    WHERE er.tenant_id = $1
      AND er.expense_category = 'Direct Operational'
      AND er.date >= '2026-07-01'
    GROUP BY er.sub_category
    ORDER BY total DESC
  `,
    [TENANT],
  );
  console.log("\nDirect Operational by sub_category (Jul 2026+):");
  console.table(directOp.rows);

  const lastDelete = await client.query(
    `
    SELECT metadata
    FROM user_activity_log
    WHERE tenant_id = $1
      AND event_name = 'inventory.internal_consumption.delete'
    ORDER BY created_at DESC
    LIMIT 1
  `,
    [TENANT],
  );
  console.log("\nLast IC delete metadata (10-bottle entry):");
  console.log(JSON.stringify(lastDelete.rows[0]?.metadata, null, 2));

  const deletedExpenseId =
    (lastDelete.rows[0]?.metadata as { deleted?: { expense_register_id?: string } })
      ?.deleted?.expense_register_id ?? null;
  if (deletedExpenseId) {
    const exp = await client.query(
      `SELECT id, price, quantity, amount FROM expense_register WHERE id = $1`,
      [deletedExpenseId],
    );
    console.log("\nDeleted 10-bottle expense row (if still present):", exp.rows[0] ?? "removed");
    console.log(
      "Inferred pre-fix unit cost from user report: amount 7.93 / qty 10 ≈ 0.793 (matched formula scoped WAC, not tenant WAC 1.121).",
    );
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
