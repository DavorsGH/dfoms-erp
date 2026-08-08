/**
 * Read-only: payment_methods schema + per-tenant counts on staging.
 * Usage: npx tsx scripts/probe-payment-methods-staging.ts
 */
import { connectPg } from "./lib/pg-connect";

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

async function main() {
  const { client } = await connectPg({ requiredProjectRef: "wieflwbfdmjtsdnwbfii" });
  try {
    const cols = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'payment_methods'
      ORDER BY ordinal_position
    `);
    console.log("COLUMNS:", cols.rows);

    const pk = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.payment_methods'::regclass
    `);
    console.log("CONSTRAINTS:", pk.rows);

    const davors = await client.query(
      `SELECT name, tenant_id FROM payment_methods WHERE tenant_id = $1 ORDER BY name`,
      [DAVORS_TENANT_ID],
    );
    console.log("DAVORS COUNT:", davors.rowCount);
    console.log("DAVORS NAMES:", davors.rows.map((r) => r.name).join(", "));

    const byTenant = await client.query(`
      SELECT t.name AS tenant_name, pm.tenant_id, COUNT(*)::int AS cnt,
             string_agg(pm.name, ', ' ORDER BY pm.name) AS names
      FROM payment_methods pm
      JOIN tenants t ON t.id = pm.tenant_id
      GROUP BY t.name, pm.tenant_id
      ORDER BY t.name
    `);
    console.log("BY TENANT:");
    for (const row of byTenant.rows) {
      console.log(`  ${row.tenant_name}: ${row.cnt} -> ${row.names}`);
    }

    const emptyTenants = await client.query(`
      SELECT t.id, t.name
      FROM tenants t
      WHERE NOT EXISTS (
        SELECT 1 FROM payment_methods pm WHERE pm.tenant_id = t.id
      )
      ORDER BY t.name
    `);
    console.log("TENANTS WITH ZERO payment_methods:", emptyTenants.rows);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
