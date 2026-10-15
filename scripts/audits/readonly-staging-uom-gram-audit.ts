/**
 * Read-only staging audit: unit-of-measure distinct values + gram-item impact.
 * Method: direct Postgres via DATABASE_URL from .env.staging.local (service role DB URL).
 * No INSERT/UPDATE/DELETE. Run: npx tsx scripts/audits/readonly-staging-uom-gram-audit.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

type Row = Record<string, unknown>;

async function main() {
  const root = resolve(import.meta.dirname, "../..");
  loadEnv(resolve(root, ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING_REF)) {
    throw new Error(
      `.env.staging.local does not look like staging (expected ref ${STAGING_REF})`,
    );
  }
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL missing in .env.staging.local");
  }

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const report: Record<string, unknown> = {
    queryMethod:
      "npx tsx scripts/audits/readonly-staging-uom-gram-audit.ts — pg.Client + DATABASE_URL from .env.staging.local (read-only SELECT)",
    stagingRef: STAGING_REF,
    generatedAt: new Date().toISOString(),
  };

  const uomColumns = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(`
    SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND (
        c.column_name = 'unit_of_measure'
        OR c.column_name = 'unit'
      )
    ORDER BY c.table_name, c.column_name
  `);

  const distinctByColumn: Row[] = [];
  for (const col of uomColumns.rows) {
    const q = `SELECT ${col.column_name} AS value, COUNT(*)::int AS row_count
      FROM public.${col.table_name}
      GROUP BY 1 ORDER BY row_count DESC NULLS LAST, value NULLS LAST LIMIT 200`;
    const { rows } = await client.query(q);
    distinctByColumn.push({
      table: col.table_name,
      column: col.column_name,
      dataType: col.data_type,
      distinctValues: rows,
    });
  }
  report.uomColumnsDistinct = distinctByColumn;

  const gramMasters = await client.query(`
    WITH rm AS (
      SELECT tenant_id, id, material_code AS code, material_name AS name,
             unit_of_measure AS unit, current_stock,
             average_cost_per_unit AS avg_cost, NULL::numeric AS selling_price,
             'raw_materials'::text AS source
      FROM raw_materials
      WHERE lower(trim(unit_of_measure)) IN ('g','gram','grams','gm')
    ),
    fp AS (
      SELECT tenant_id, id, product_code AS code, product_name AS name,
             unit_of_measure AS unit, current_stock,
             NULL::numeric AS avg_cost, standard_selling_price AS selling_price,
             'finished_products'::text AS source
      FROM finished_products
      WHERE lower(trim(unit_of_measure)) IN ('g','gram','grams','gm')
    ),
    ci AS (
      SELECT tenant_id, id, item_code AS code, name,
             unit AS unit, NULL::numeric AS current_stock,
             NULL::numeric AS avg_cost, NULL::numeric AS selling_price,
             'consumable_items'::text AS source
      FROM consumable_items
      WHERE lower(trim(coalesce(unit, ''))) IN ('g','gram','grams','gm')
    )
    SELECT * FROM rm
    UNION ALL SELECT * FROM fp
    UNION ALL SELECT * FROM ci
    ORDER BY tenant_id, source, code
  `);
  report.gramItemMasters = gramMasters.rows;

  const byTenant = new Map<string, Row[]>();
  for (const row of gramMasters.rows as Row[]) {
    const tid = String(row.tenant_id);
    const list = byTenant.get(tid) ?? [];
    list.push(row);
    byTenant.set(tid, list);
  }

  const tenantNames = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM tenants ORDER BY name`,
  );
  const tenantNameById = new Map(
    tenantNames.rows.map((r) => [r.id, r.name]),
  );

  type ChildProbe = {
    label: string;
    sql: string;
    params: unknown[];
  };

  async function probeChildTables(
    rmIds: string[],
    fpIds: string[],
    ciIds: string[],
  ): Promise<Row[]> {
    const probes: ChildProbe[] = [];
    const push = (label: string, sql: string, params: unknown[]) =>
      probes.push({ label, sql, params });

    if (rmIds.length) {
      push(
        "raw_material_purchases",
        `SELECT COUNT(*)::int AS row_count FROM raw_material_purchases WHERE material_id = ANY($1::uuid[])`,
        [rmIds],
      );
      push(
        "raw_material_purchases (sample)",
        `SELECT id, material_id, quantity, cost_per_unit, total_cost, purchase_date
         FROM raw_material_purchases WHERE material_id = ANY($1::uuid[]) ORDER BY purchase_date DESC LIMIT 5`,
        [rmIds],
      );
      push(
        "raw_material_stock_adjustments",
        `SELECT COUNT(*)::int AS row_count FROM raw_material_stock_adjustments WHERE material_id = ANY($1::uuid[])`,
        [rmIds],
      );
      push(
        "raw_material_stock_adjustments (sample)",
        `SELECT id, material_id, quantity_delta, cost_per_unit, adjustment_type, created_at
         FROM raw_material_stock_adjustments WHERE material_id = ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 5`,
        [rmIds],
      );
      push(
        "raw_material_balances",
        `SELECT COUNT(*)::int AS row_count FROM raw_material_balances WHERE material_id = ANY($1::uuid[])`,
        [rmIds],
      );
      push(
        "raw_material_balances (sample)",
        `SELECT material_id, business_unit_id, current_stock, average_cost_per_unit
         FROM raw_material_balances WHERE material_id = ANY($1::uuid[]) LIMIT 5`,
        [rmIds],
      );
      push(
        "production_batch_materials",
        `SELECT COUNT(*)::int AS row_count FROM production_batch_materials WHERE material_id = ANY($1::uuid[])`,
        [rmIds],
      );
      push(
        "production_batch_materials (sample)",
        `SELECT id, batch_id, material_id, quantity_used, cost_at_time
         FROM production_batch_materials WHERE material_id = ANY($1::uuid[]) ORDER BY id DESC LIMIT 5`,
        [rmIds],
      );
      push(
        "purchase_order_items (raw)",
        `SELECT COUNT(*)::int AS row_count FROM purchase_order_items
         WHERE raw_material_id = ANY($1::uuid[])`,
        [rmIds],
      );
      push(
        "purchase_order_items (raw sample)",
        `SELECT id, quantity_ordered, quantity_received, unit_cost
         FROM purchase_order_items WHERE raw_material_id = ANY($1::uuid[]) LIMIT 5`,
        [rmIds],
      );
    }

    if (fpIds.length) {
      push(
        "product_purchases",
        `SELECT COUNT(*)::int AS row_count FROM product_purchases WHERE product_id = ANY($1::uuid[])`,
        [fpIds],
      );
      push(
        "product_purchases (sample)",
        `SELECT id, product_id, quantity, cost_per_unit, total_cost, purchase_date
         FROM product_purchases WHERE product_id = ANY($1::uuid[]) ORDER BY purchase_date DESC LIMIT 5`,
        [fpIds],
      );
      push(
        "finished_product_stock_adjustments",
        `SELECT COUNT(*)::int AS row_count FROM finished_product_stock_adjustments WHERE product_id = ANY($1::uuid[])`,
        [fpIds],
      );
      push(
        "finished_product_stock_adjustments (sample)",
        `SELECT id, product_id, quantity_delta, cost_per_unit, adjustment_type, created_at
         FROM finished_product_stock_adjustments WHERE product_id = ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 5`,
        [fpIds],
      );
      push(
        "finished_product_balances",
        `SELECT COUNT(*)::int AS row_count FROM finished_product_balances WHERE product_id = ANY($1::uuid[])`,
        [fpIds],
      );
      push(
        "finished_product_balances (sample)",
        `SELECT product_id, business_unit_id, current_stock, average_cost_per_unit
         FROM finished_product_balances WHERE product_id = ANY($1::uuid[]) LIMIT 5`,
        [fpIds],
      );
      push(
        "production_batches",
        `SELECT COUNT(*)::int AS row_count FROM production_batches WHERE finished_product_id = ANY($1::uuid[])`,
        [fpIds],
      );
      push(
        "production_batches (sample)",
        `SELECT id, batch_number, quantity_produced, cost_per_unit_produced, total_batch_cost
         FROM production_batches WHERE finished_product_id = ANY($1::uuid[]) ORDER BY production_date DESC LIMIT 5`,
        [fpIds],
      );
      push(
        "internal_consumption",
        `SELECT COUNT(*)::int AS row_count FROM internal_consumption WHERE product_id = ANY($1::uuid[])`,
        [fpIds],
      );
      push(
        "internal_consumption (sample)",
        `SELECT id, product_id, quantity, consumption_date FROM internal_consumption
         WHERE product_id = ANY($1::uuid[]) ORDER BY consumption_date DESC LIMIT 5`,
        [fpIds],
      );
      push(
        "income_register (product sales)",
        `SELECT COUNT(*)::int AS row_count FROM income_register
         WHERE product_id = ANY($1::uuid[]) AND sale_quantity IS NOT NULL`,
        [fpIds],
      );
      push(
        "income_register (sample)",
        `SELECT id, product_id, sale_quantity, unit_price, amount, date
         FROM income_register WHERE product_id = ANY($1::uuid[]) AND sale_quantity IS NOT NULL
         ORDER BY date DESC LIMIT 5`,
        [fpIds],
      );
      push(
        "purchase_order_items (finished)",
        `SELECT COUNT(*)::int AS row_count FROM purchase_order_items
         WHERE finished_product_id = ANY($1::uuid[])`,
        [fpIds],
      );
      push(
        "purchase_order_items (finished sample)",
        `SELECT id, quantity_ordered, quantity_received, unit_cost
         FROM purchase_order_items WHERE finished_product_id = ANY($1::uuid[]) LIMIT 5`,
        [fpIds],
      );
      push(
        "pos_cart_lines (if exists)",
        `SELECT COUNT(*)::int AS row_count FROM pos_cart_lines WHERE product_id = ANY($1::uuid[])`,
        [fpIds],
      );
    }

    if (ciIds.length) {
      push(
        "consumable_movements",
        `SELECT COUNT(*)::int AS row_count FROM consumable_movements WHERE item_id = ANY($1::uuid[])`,
        [ciIds],
      );
      push(
        "consumable_movements (sample)",
        `SELECT id, item_id, movement_type, quantity, unit_cost, movement_date
         FROM consumable_movements WHERE item_id = ANY($1::uuid[]) ORDER BY movement_date DESC LIMIT 5`,
        [ciIds],
      );
    }

    const out: Row[] = [];
    for (const p of probes) {
      try {
        const { rows } = await client.query(p.sql, p.params);
        out.push({ probe: p.label, result: rows });
      } catch (error) {
        out.push({
          probe: p.label,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return out;
  }

  const gramByTenant: Row[] = [];
  for (const [tenantId, masters] of byTenant) {
    const rmIds = masters
      .filter((m) => m.source === "raw_materials")
      .map((m) => m.id as string);
    const fpIds = masters
      .filter((m) => m.source === "finished_products")
      .map((m) => m.id as string);
    const ciIds = masters
      .filter((m) => m.source === "consumable_items")
      .map((m) => m.id as string);
    gramByTenant.push({
      tenantId,
      tenantName: tenantNameById.get(tenantId) ?? null,
      itemMasters: masters,
      relatedTables: await probeChildTables(rmIds, fpIds, ciIds),
    });
  }
  if (byTenant.size === 0) {
    gramByTenant.push({
      tenantId: null,
      tenantName: null,
      note: "No gram-unit item masters found on staging.",
      itemMasters: [],
      relatedTables: [],
    });
  }
  report.gramImpactByTenant = gramByTenant;

  const inventoryFns = await client.query(`
    SELECT p.proname AS name,
           pg_get_function_identity_arguments(p.oid) AS args,
           CASE p.provolatile WHEN 'i' THEN 'immutable' WHEN 's' THEN 'stable' ELSE 'volatile' END AS volatility,
           p.prosecdef AS security_definer
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname ILIKE '%weighted%avg%'
        OR p.proname ILIKE '%average_cost%'
        OR p.proname ILIKE '%raw_material%purchase%'
        OR p.proname ILIKE '%recalc%material%'
        OR p.proname ILIKE '%apply_raw_material%'
        OR p.proname ILIKE '%apply_product_purchase%'
        OR p.proname ILIKE '%production_batch%'
      )
    ORDER BY p.proname
  `);
  report.inventoryCostStockFunctions = inventoryFns.rows;

  const triggers = await client.query(`
    SELECT event_object_table AS table_name, trigger_name, action_timing, event_manipulation,
           action_statement
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table IN (
        'raw_material_purchases', 'raw_material_stock_adjustments',
        'product_purchases', 'finished_product_stock_adjustments',
        'production_batches', 'production_batch_materials',
        'internal_consumption', 'income_register', 'consumable_movements',
        'raw_materials', 'finished_products'
      )
    ORDER BY event_object_table, trigger_name
  `);
  report.relevantTriggers = triggers.rows;

  const fkDeps = await client.query(`
    SELECT
      tc.table_name AS child_table,
      kcu.column_name AS child_column,
      ccu.table_name AS parent_table,
      ccu.column_name AS parent_column,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name IN ('raw_materials', 'finished_products', 'consumable_items')
    ORDER BY child_table, child_column
  `);
  report.fkDependenciesOnItemMasters = fkDeps.rows;

  report.conversionRulesNote = {
    perColumn:
      "For gram masters migrating to kg: divide quantity columns by 1000; multiply per-unit cost/price columns by 1000; line totals (qty × unit cost/price) unchanged.",
    masterUnitColumn: "Set unit_of_measure / unit to 'kg' on item master only after child quantities/costs are converted.",
    directUpdateVsTriggers:
      "Direct UPDATE on historical rows does NOT re-fire INSERT triggers (e.g. trg_apply_raw_material_purchase). Stored current_stock / average_cost on balances may diverge until recalc RPCs run or new movements occur. WAC functions (finished_product_weighted_avg_cost_scoped, purchase-sum loops) recompute from source rows — converted source data yields correct kg-based WAC without rewriting masters alone.",
    recipeYields:
      "production_batch_materials.quantity_used and production_batches.quantity_produced are unit-agnostic numbers tied to master UoM; converting g→kg requires consistent ÷1000 on all batch input/output quantities for affected materials/products.",
    appCode:
      "utils/units-of-measure presets exclude g; formatUnit does not map g→kg. App WAC for consumables: computeWeightedAverageState in consumables-store-utils.ts (movement-based, no unit conversion).",
  };

  await client.end();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
