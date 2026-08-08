/**
 * Apply script 180 and verify payment_methods tenant seed on staging.
 *
 * Usage: npx tsx scripts/apply-180-payment-methods-seed-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const EXPECTED_DAVORS_NAMES = [
  "Bank Transfer",
  "Cash",
  "Cheque",
  "Credit",
  "Mobile Money",
  "POS",
];

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
  });
  console.log(`Connected using ${envFile}`);

  const sql = readFileSync(
    resolve(process.cwd(), "scripts/180_payment_methods_tenant_seed.sql"),
    "utf8",
  );

  try {
    const before = await client.query(`
      SELECT t.name AS tenant_name, COUNT(pm.name)::int AS cnt,
             COALESCE(string_agg(pm.name, ', ' ORDER BY pm.name), '') AS names
      FROM tenants t
      LEFT JOIN payment_methods pm ON pm.tenant_id = t.id
      GROUP BY t.id, t.name
      ORDER BY t.name
    `);
    console.log("\n=== BEFORE ===");
    for (const row of before.rows) {
      console.log(`${row.tenant_name}: ${row.cnt} [${row.names}]`);
    }

    console.log("\n=== Applying 180_payment_methods_tenant_seed.sql ===");
    await client.query(sql);
    console.log("PASS script 180 applied");

    const after = await client.query(`
      SELECT t.name AS tenant_name, COUNT(pm.name)::int AS cnt,
             COALESCE(string_agg(pm.name, ', ' ORDER BY pm.name), '') AS names
      FROM tenants t
      LEFT JOIN payment_methods pm ON pm.tenant_id = t.id
      GROUP BY t.id, t.name
      ORDER BY t.name
    `);
    console.log("\n=== AFTER ===");
    for (const row of after.rows) {
      console.log(`${row.tenant_name}: ${row.cnt} [${row.names}]`);
    }

    const davors = await client.query(
      `SELECT name FROM payment_methods WHERE tenant_id = $1 ORDER BY name`,
      [DAVORS_TENANT_ID],
    );
    const davorsNames = davors.rows.map((r) => r.name);
    if (JSON.stringify(davorsNames) !== JSON.stringify(EXPECTED_DAVORS_NAMES)) {
      throw new Error(
        `Davors list changed unexpectedly: ${davorsNames.join(", ")}`,
      );
    }
    console.log("\nPASS Davors template unchanged (6 methods incl. Credit)");

    const empty = after.rows.filter((r) => Number(r.cnt) === 0);
    if (empty.length > 0) {
      throw new Error(
        `Tenants still empty after seed: ${empty.map((r) => r.tenant_name).join(", ")}`,
      );
    }
    console.log("PASS no tenant left with zero payment_methods");

    const seeded = before.rows.filter((r) => Number(r.cnt) === 0);
    for (const row of seeded) {
      const afterRow = after.rows.find((r) => r.tenant_name === row.tenant_name);
      if (!afterRow || Number(afterRow.cnt) !== EXPECTED_DAVORS_NAMES.length) {
        throw new Error(`Seed failed for ${row.tenant_name}`);
      }
      if (!String(afterRow.names).includes("Credit")) {
        throw new Error(`${row.tenant_name} missing Credit after seed`);
      }
      console.log(`PASS seeded ${row.tenant_name} -> full Davors list (${afterRow.cnt})`);
    }

    const preExisting = before.rows.filter((r) => Number(r.cnt) > 0);
    for (const row of preExisting) {
      const afterRow = after.rows.find((r) => r.tenant_name === row.tenant_name);
      if (!afterRow || afterRow.cnt !== row.cnt || afterRow.names !== row.names) {
        throw new Error(
          `Existing tenant customized list changed: ${row.tenant_name}`,
        );
      }
      console.log(
        `PASS preserved ${row.tenant_name} custom list (${row.cnt} methods, unchanged)`,
      );
    }

    console.log("\nALL PASS — payment_methods tenant seed verified on staging");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
