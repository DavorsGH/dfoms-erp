/**
 * Read-only: confirm production Supabase has BU access migrations applied.
 *
 * Usage:
 *   npx tsx scripts/probe-production-bu-migration-scope-readonly.ts --env-file .env.local.backup --allow-production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const PRODUCTION_URL = "https://portal.davorsfacilities.com";

const SALES_TABLES = [
  "projects",
  "income_register",
  "finished_products",
  "crm_products",
  "sales_opportunities",
] as const;

const TIER_D_TABLES = [
  "product_purchases",
  "production_batches",
  "purchase_orders",
  "purchase_order_items",
  "raw_material_purchases",
  "raw_material_stock_adjustments",
  "finished_product_stock_adjustments",
  "finished_product_balances",
  "raw_material_balances",
  "stock_movements",
  "inventory_balance_config",
] as const;

const ALL_TABLES = [...SALES_TABLES, ...TIER_D_TABLES];

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

function parseArgs() {
  const args = process.argv.slice(2);
  let envFile = ".env.local.backup";
  let allowProduction = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--env-file" && args[i + 1]) {
      envFile = args[i + 1]!;
      i += 1;
    } else if (args[i] === "--allow-production") {
      allowProduction = true;
    }
  }
  return { envFile, allowProduction };
}

async function fetchProductionDeploySha(): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {
    url: PRODUCTION_URL,
    "x-vercel-id": null,
    "x-vercel-git-commit-sha": null,
    "x-vercel-git-commit-message": null,
    "x-vercel-git-commit-author-name": null,
    "x-vercel-git-commit-ref": null,
    "x-vercel-deployment-url": null,
  };
  try {
    const res = await fetch(`${PRODUCTION_URL}/login`, {
      redirect: "manual",
      headers: { "User-Agent": "dfoms-probe-production-bu-scope/1.0" },
    });
    for (const key of Object.keys(out)) {
      if (key === "url") continue;
      const header = key.replace(/_/g, "-");
      out[key] = res.headers.get(header);
    }
  } catch (error) {
    out.fetch_error = String(error);
  }
  return out;
}

async function main() {
  const { envFile, allowProduction } = parseArgs();
  if (!allowProduction) {
    throw new Error("Pass --allow-production to probe production Supabase.");
  }

  loadEnv(resolve(process.cwd(), envFile));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes(PRODUCTION_REF)) {
    throw new Error(
      `Refusing: NEXT_PUBLIC_SUPABASE_URL must contain ${PRODUCTION_REF}, got ${supabaseUrl || "(empty)"}`,
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL missing");

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    console.log("=== PRODUCTION BU MIGRATION SCOPE PROBE (read-only) ===");
    console.log(`supabase_ref: ${PRODUCTION_REF}`);
    console.log(`env_file: ${envFile}`);
    console.log("");

    const tableExists = await client.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'user_business_unit_access'
        ) AS exists
      `,
    );
    console.log("1) user_business_unit_access table exists:");
    console.log(JSON.stringify(tableExists.rows[0], null, 2));
    console.log("");

    const fnExists = await client.query(
      `
        SELECT
          p.proname,
          pg_get_function_identity_arguments(p.oid) AS args,
          pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'user_has_business_unit_access'
        ORDER BY p.oid
      `,
    );
    console.log("2) user_has_business_unit_access() function:");
    if (fnExists.rows.length === 0) {
      console.log(JSON.stringify({ exists: false, overloads: [] }, null, 2));
    } else {
      console.log(
        JSON.stringify(
          {
            exists: true,
            overload_count: fnExists.rows.length,
            overloads: fnExists.rows.map((r) => ({
              proname: r.proname,
              args: r.args,
            })),
            definition_preview: String(fnExists.rows[0]?.definition ?? "").slice(
              0,
              500,
            ),
          },
          null,
          2,
        ),
      );
    }
    console.log("");

    const businessUnits = await client.query(
      `
        SELECT id, tenant_id, name, created_at
        FROM public.business_units
        WHERE tenant_id = $1
        ORDER BY name
      `,
      [DAVORS_TENANT_ID],
    );
    console.log("3) business_units rows for Davors tenant:");
    console.log(JSON.stringify(businessUnits.rows, null, 2));
    console.log("");

    const policies = await client.query(
      `
        SELECT tablename, policyname, cmd, qual, with_check
        FROM pg_policies
        WHERE tablename = ANY($1::text[])
          AND (
            COALESCE(qual, '') ILIKE '%user_has_business_unit_access%'
            OR COALESCE(with_check, '') ILIKE '%user_has_business_unit_access%'
          )
        ORDER BY tablename, policyname
      `,
      [ALL_TABLES],
    );
    console.log(
      "4) RLS policies referencing user_has_business_unit_access (sales + Tier D tables):",
    );
    console.log(`matched_policy_count: ${policies.rows.length}`);
    console.log(JSON.stringify(policies.rows, null, 2));

    const tablesWithBuFn = await client.query(
      `
        SELECT tablename, count(*)::int AS policy_count
        FROM pg_policies
        WHERE tablename = ANY($1::text[])
          AND (
            COALESCE(qual, '') ILIKE '%user_has_business_unit_access%'
            OR COALESCE(with_check, '') ILIKE '%user_has_business_unit_access%'
          )
        GROUP BY tablename
        ORDER BY tablename
      `,
      [ALL_TABLES],
    );
    console.log("");
    console.log("4b) per-table policy counts with user_has_business_unit_access:");
    console.log(JSON.stringify(tablesWithBuFn.rows, null, 2));

    const missingTables = ALL_TABLES.filter(
      (t) => !tablesWithBuFn.rows.some((r) => r.tablename === t),
    );
    console.log("");
    console.log("4c) tables WITHOUT any user_has_business_unit_access policy:");
    console.log(JSON.stringify(missingTables, null, 2));

    const salesPolicies = await client.query(
      `
        SELECT tablename, policyname, cmd, qual, with_check
        FROM pg_policies
        WHERE tablename = ANY($1::text[])
        ORDER BY tablename, policyname
      `,
      [SALES_TABLES],
    );
    console.log("");
    console.log("4d) ALL current RLS policies on sales-scoped tables (production baseline):");
    console.log(JSON.stringify(salesPolicies.rows, null, 2));

    if (tableExists.rows[0]?.exists) {
      const accessRows = await client.query(
        `
          SELECT tenant_id, auth_uid, business_unit_id, is_default, created_at
          FROM public.user_business_unit_access
          WHERE tenant_id = $1
          ORDER BY auth_uid, business_unit_id
        `,
        [DAVORS_TENANT_ID],
      );
      console.log("");
      console.log("1b) user_business_unit_access rows for Davors tenant:");
      console.log(JSON.stringify(accessRows.rows, null, 2));
    } else {
      console.log("");
      console.log("1c) PostgREST probe for missing table (expected error):");
      console.log(
        JSON.stringify(
          {
            note: "Table absent in information_schema; app queries via .from('user_business_unit_access') will fail at runtime.",
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await client.end();
  }

  console.log("");
  console.log("5) Production Vercel deployment headers (/login):");
  const deploy = await fetchProductionDeploySha();
  console.log(JSON.stringify(deploy, null, 2));

  const sha = deploy["x-vercel-git-commit-sha"];
  if (sha) {
    console.log("");
    console.log(`deployed_commit_short: ${String(sha).slice(0, 7)}`);
    console.log(`deployed_commit_full: ${sha}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
