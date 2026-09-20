/** Read-only staging contrast for BU migration objects. */
import { readFileSync } from "node:fs";
import pg from "pg";

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
  loadEnv(".env.staging.local");
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const table = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'user_business_unit_access'
      ) AS exists
    `);
    const fn = await client.query(`
      SELECT count(*)::int AS overloads
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'user_has_business_unit_access'
    `);
    const bu = await client.query(`
      SELECT id, name FROM business_units
      WHERE tenant_id = '00000001-0000-4000-8000-000000000001'
      ORDER BY name
    `);
    const pol = await client.query(`
      SELECT count(*)::int AS policies
      FROM pg_policies
      WHERE COALESCE(qual, '') ILIKE '%user_has_business_unit_access%'
         OR COALESCE(with_check, '') ILIKE '%user_has_business_unit_access%'
    `);
    console.log(
      JSON.stringify(
        {
          staging_ref: "wieflwbfdmjtsdnwbfii",
          user_business_unit_access_table: table.rows[0],
          user_has_business_unit_access_overloads: fn.rows[0]?.overloads,
          davors_business_units: bu.rows,
          rls_policies_referencing_fn: pol.rows[0]?.policies,
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
