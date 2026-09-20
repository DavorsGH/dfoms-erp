/**
 * Read-only: production schema checks for BU switcher at commit 859132a.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

async function main() {
  loadEnv(resolve(".env.local.backup"));
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCTION_REF)) {
    throw new Error("Refusing: not production env");
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const buCols = await client.query(
      `
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'business_units'
        ORDER BY ordinal_position
      `,
    );

    const uaCols = await client.query(
      `
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user_accounts'
          AND column_name IN (
            'active_business_unit_id',
            'view_all_business_units'
          )
        ORDER BY column_name
      `,
    );

    const buRows = await client.query(
      `
        SELECT id, tenant_id, name, is_active, created_at
        FROM public.business_units
        WHERE tenant_id = $1
        ORDER BY name
      `,
      [DAVORS_TENANT_ID],
    );

    const david = await client.query(
      `
        SELECT auth_uid, email, role, is_active,
               active_business_unit_id, view_all_business_units
        FROM public.user_accounts
        WHERE tenant_id = $1
          AND (
            lower(email) LIKE '%david%'
            OR lower(email) LIKE '%avors%'
          )
        ORDER BY email
        LIMIT 20
      `,
      [DAVORS_TENANT_ID],
    );

    const simulateUpdate = await client.query(
      `
        SELECT id, name, is_active,
               (is_active IS TRUE) AS is_active_strict_true,
               (is_active = true) AS is_active_eq_true
        FROM public.business_units
        WHERE tenant_id = $1
        ORDER BY name
      `,
      [DAVORS_TENANT_ID],
    );

    console.log(
      JSON.stringify(
        {
          business_units_columns: buCols.rows,
          user_accounts_bu_columns: uaCols.rows,
          davors_business_units: buRows.rows,
          is_active_route_check_simulation: simulateUpdate.rows,
          likely_staff_accounts: david.rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
