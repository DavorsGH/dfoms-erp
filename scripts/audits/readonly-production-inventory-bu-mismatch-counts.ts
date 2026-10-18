/**
 * Read-only: per-tenant / stamped-BU counts where inventory row BU != catalog item BU.
 * Only counts rows where BOTH stamped BU and catalog BU are non-null (same rule as app guard).
 *
 * Usage:
 *   npx tsx scripts/audits/readonly-production-inventory-bu-mismatch-counts.ts --env production
 *   npx tsx scripts/audits/readonly-production-inventory-bu-mismatch-counts.ts --env staging
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PROD_REF = "tvcurcnmasnocwdxzgvz";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function loadEnvironment(envArg: string) {
  const repoRoot = resolve(process.cwd());
  if (envArg === "production") {
    const prodEnvCandidates = [
      ".env.local.backup",
      ".env.vercel.production.local",
      ".env.production.local",
    ];
    let loaded = false;
    for (const file of prodEnvCandidates) {
      const path = resolve(repoRoot, file);
      if (existsSync(path)) {
        loadEnvForce(path);
        loaded = true;
        console.log(`Loaded production env from ${file}`);
        break;
      }
    }
    if (!loaded) {
      throw new Error(
        "No production env file found (.env.local.backup, .env.vercel.production.local, or .env.production.local)",
      );
    }
  } else {
    loadEnvForce(resolve(repoRoot, ".env.staging.local"));
    if (existsSync(resolve(repoRoot, ".env.local"))) {
      loadEnvForce(resolve(repoRoot, ".env.local"));
    }
    console.log("Loaded staging env (.env.staging.local + optional .env.local)");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (envArg === "production") {
    if (url.includes(STAGING_REF)) {
      throw new Error(
        "Refusing: production run loaded staging Supabase URL (check env file — do not use .env.local alone for production)",
      );
    }
    if (!url.includes(PROD_REF)) {
      throw new Error(
        `Refusing: expected production project ref ${PROD_REF} in NEXT_PUBLIC_SUPABASE_URL`,
      );
    }
  } else if (!url.includes(STAGING_REF)) {
    throw new Error(`Refusing: expected staging project ref ${STAGING_REF}`);
  }

  console.log(`Supabase URL host ref: ${url.includes(STAGING_REF) ? "staging" : "production"}`);
}

const envArg =
  process.argv.find((a) => a.startsWith("--env="))?.split("=")[1] ?? "production";
loadEnvironment(envArg);

const connectionString =
  process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? "";

if (!connectionString) {
  console.error("Missing DATABASE_URL or SUPABASE_DB_URL in selected env.");
  process.exit(1);
}

const dbHostHint = (() => {
  try {
    return new URL(connectionString.replace(/^postgres:/, "postgresql:")).hostname;
  } catch {
    return "(unparsed)";
  }
})();
console.log(`DATABASE_URL host: ${dbHostHint}\n`);

type CountRow = {
  table_name: string;
  tenant_id: string;
  tenant_name: string;
  stamped_business_unit_id: string | null;
  stamped_business_unit_name: string | null;
  mismatch_count: string;
};

const QUERIES: { table_name: string; sql: string }[] = [
  {
    table_name: "product_purchases",
    sql: `
      SELECT pp.tenant_id, t.name AS tenant_name,
             pp.business_unit_id AS stamped_business_unit_id,
             bu.name AS stamped_business_unit_name,
             COUNT(*)::bigint AS mismatch_count
      FROM product_purchases pp
      JOIN tenants t ON t.id = pp.tenant_id
      JOIN finished_products fp ON fp.id = pp.product_id
      LEFT JOIN business_units bu ON bu.id = pp.business_unit_id
      WHERE EXISTS (
        SELECT 1 FROM business_units bx
        WHERE bx.tenant_id = pp.tenant_id AND bx.is_active = true
      )
      AND pp.business_unit_id IS NOT NULL
      AND fp.business_unit_id IS NOT NULL
      AND pp.business_unit_id IS DISTINCT FROM fp.business_unit_id
      GROUP BY pp.tenant_id, t.name, pp.business_unit_id, bu.name
      ORDER BY t.name, bu.name NULLS FIRST
    `,
  },
  {
    table_name: "purchase_order_items (finished product lines)",
    sql: `
      SELECT poi.tenant_id, t.name AS tenant_name,
             po.business_unit_id AS stamped_business_unit_id,
             bu.name AS stamped_business_unit_name,
             COUNT(*)::bigint AS mismatch_count
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.po_id
      JOIN tenants t ON t.id = poi.tenant_id
      JOIN finished_products fp ON fp.id = poi.finished_product_id
      LEFT JOIN business_units bu ON bu.id = po.business_unit_id
      WHERE poi.item_type = 'finished_product'
      AND EXISTS (
        SELECT 1 FROM business_units bx
        WHERE bx.tenant_id = poi.tenant_id AND bx.is_active = true
      )
      AND po.business_unit_id IS NOT NULL
      AND fp.business_unit_id IS NOT NULL
      AND po.business_unit_id IS DISTINCT FROM fp.business_unit_id
      GROUP BY poi.tenant_id, t.name, po.business_unit_id, bu.name
      ORDER BY t.name, bu.name NULLS FIRST
    `,
  },
  {
    table_name: "income_register (product sales / POS)",
    sql: `
      SELECT ir.tenant_id, t.name AS tenant_name,
             ir.business_unit_id AS stamped_business_unit_id,
             bu.name AS stamped_business_unit_name,
             COUNT(*)::bigint AS mismatch_count
      FROM income_register ir
      JOIN tenants t ON t.id = ir.tenant_id
      JOIN finished_products fp ON fp.id = ir.product_id
      LEFT JOIN business_units bu ON bu.id = ir.business_unit_id
      WHERE ir.product_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM business_units bx
        WHERE bx.tenant_id = ir.tenant_id AND bx.is_active = true
      )
      AND ir.business_unit_id IS NOT NULL
      AND fp.business_unit_id IS NOT NULL
      AND ir.business_unit_id IS DISTINCT FROM fp.business_unit_id
      GROUP BY ir.tenant_id, t.name, ir.business_unit_id, bu.name
      ORDER BY t.name, bu.name NULLS FIRST
    `,
  },
  {
    table_name: "finished_product_stock_adjustments",
    sql: `
      SELECT a.tenant_id, t.name AS tenant_name,
             a.business_unit_id AS stamped_business_unit_id,
             bu.name AS stamped_business_unit_name,
             COUNT(*)::bigint AS mismatch_count
      FROM finished_product_stock_adjustments a
      JOIN tenants t ON t.id = a.tenant_id
      JOIN finished_products fp ON fp.id = a.product_id
      LEFT JOIN business_units bu ON bu.id = a.business_unit_id
      WHERE EXISTS (
        SELECT 1 FROM business_units bx
        WHERE bx.tenant_id = a.tenant_id AND bx.is_active = true
      )
      AND a.business_unit_id IS NOT NULL
      AND fp.business_unit_id IS NOT NULL
      AND a.business_unit_id IS DISTINCT FROM fp.business_unit_id
      GROUP BY a.tenant_id, t.name, a.business_unit_id, bu.name
      ORDER BY t.name, bu.name NULLS FIRST
    `,
  },
  {
    table_name: "raw_material_stock_adjustments",
    sql: `
      SELECT a.tenant_id, t.name AS tenant_name,
             a.business_unit_id AS stamped_business_unit_id,
             bu.name AS stamped_business_unit_name,
             COUNT(*)::bigint AS mismatch_count
      FROM raw_material_stock_adjustments a
      JOIN tenants t ON t.id = a.tenant_id
      JOIN raw_materials rm ON rm.id = a.material_id
      LEFT JOIN business_units bu ON bu.id = a.business_unit_id
      WHERE EXISTS (
        SELECT 1 FROM business_units bx
        WHERE bx.tenant_id = a.tenant_id AND bx.is_active = true
      )
      AND a.business_unit_id IS DISTINCT FROM rm.business_unit_id
      GROUP BY a.tenant_id, t.name, a.business_unit_id, bu.name
      ORDER BY t.name, bu.name NULLS FIRST
    `,
  },
  {
    table_name: "internal_consumption",
    sql: `
      SELECT ic.tenant_id, t.name AS tenant_name,
             ic.business_unit_id AS stamped_business_unit_id,
             bu.name AS stamped_business_unit_name,
             COUNT(*)::bigint AS mismatch_count
      FROM internal_consumption ic
      JOIN tenants t ON t.id = ic.tenant_id
      JOIN finished_products fp ON fp.id = ic.product_id
      LEFT JOIN business_units bu ON bu.id = ic.business_unit_id
      WHERE EXISTS (
        SELECT 1 FROM business_units bx
        WHERE bx.tenant_id = ic.tenant_id AND bx.is_active = true
      )
      AND ic.business_unit_id IS NOT NULL
      AND fp.business_unit_id IS NOT NULL
      AND ic.business_unit_id IS DISTINCT FROM fp.business_unit_id
      GROUP BY ic.tenant_id, t.name, ic.business_unit_id, bu.name
      ORDER BY t.name, bu.name NULLS FIRST
    `,
  },
  {
    table_name: "production_batches (finished product)",
    sql: `
      SELECT pb.tenant_id, t.name AS tenant_name,
             pb.business_unit_id AS stamped_business_unit_id,
             bu.name AS stamped_business_unit_name,
             COUNT(*)::bigint AS mismatch_count
      FROM production_batches pb
      JOIN tenants t ON t.id = pb.tenant_id
      JOIN finished_products fp ON fp.id = pb.finished_product_id
      LEFT JOIN business_units bu ON bu.id = pb.business_unit_id
      WHERE EXISTS (
        SELECT 1 FROM business_units bx
        WHERE bx.tenant_id = pb.tenant_id AND bx.is_active = true
      )
      AND pb.business_unit_id IS NOT NULL
      AND fp.business_unit_id IS NOT NULL
      AND pb.business_unit_id IS DISTINCT FROM fp.business_unit_id
      GROUP BY pb.tenant_id, t.name, pb.business_unit_id, bu.name
      ORDER BY t.name, bu.name NULLS FIRST
    `,
  },
  {
    table_name: "production_batch_materials (raw material vs batch BU)",
    sql: `
      SELECT pb.tenant_id, t.name AS tenant_name,
             pb.business_unit_id AS stamped_business_unit_id,
             bu.name AS stamped_business_unit_name,
             COUNT(*)::bigint AS mismatch_count
      FROM production_batch_materials pbm
      JOIN production_batches pb ON pb.id = pbm.batch_id
      JOIN tenants t ON t.id = pb.tenant_id
      JOIN raw_materials rm ON rm.id = pbm.material_id
      LEFT JOIN business_units bu ON bu.id = pb.business_unit_id
      WHERE EXISTS (
        SELECT 1 FROM business_units bx
        WHERE bx.tenant_id = pb.tenant_id AND bx.is_active = true
      )
      AND pb.business_unit_id IS DISTINCT FROM rm.business_unit_id
      GROUP BY pb.tenant_id, t.name, pb.business_unit_id, bu.name
      ORDER BY t.name, bu.name NULLS FIRST
    `,
  },
];

async function rawMaterialsHaveCatalogBusinessUnitId(
  client: pg.Client,
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'raw_materials'
        AND column_name = 'business_unit_id'
    ) AS exists
  `);
  return rows[0]?.exists === true;
}

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const rawMaterialCatalogBu = await rawMaterialsHaveCatalogBusinessUnitId(client);

  console.log(
    `Inventory BU mismatch counts (${envArg}, both sides non-null, read-only)\n`,
  );

  for (const { table_name, sql } of QUERIES) {
    if (
      !rawMaterialCatalogBu &&
      (table_name === "raw_material_stock_adjustments" ||
        table_name === "production_batch_materials (raw material vs batch BU)")
    ) {
      console.log(`=== ${table_name} ===`);
      console.log(
        "  (skipped — raw_materials.business_unit_id not present on production)\n",
      );
      continue;
    }
    console.log(`=== ${table_name} ===`);
    const { rows } = await client.query<CountRow>(sql);
    if (rows.length === 0) {
      console.log("  (no mismatches)\n");
      continue;
    }
    for (const row of rows) {
      console.log(
        `  tenant=${row.tenant_name} (${row.tenant_id}) stamped_bu=${row.stamped_business_unit_name ?? "NULL"} (${row.stamped_business_unit_id ?? "NULL"}) count=${row.mismatch_count}`,
      );
    }
    console.log("");
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
