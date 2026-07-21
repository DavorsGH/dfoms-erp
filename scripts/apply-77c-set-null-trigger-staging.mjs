import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  throw new Error("DATABASE_URL missing");
}

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
client.on("notice", (msg) => console.log("NOTICE:", msg.message));
await client.connect();

try {
  const patchSql = readFileSync(
    resolve(process.cwd(), "../../06 Database/77c_user_accounts_client_set_null_trigger.sql"),
    "utf8",
  );

  console.log("=== Applying 77c_user_accounts_client_set_null_trigger.sql ===");
  await client.query(patchSql);

  const defs = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conname = 'user_accounts_client_id_fkey'
  `);
  console.log("=== FK definition after 77c ===");
  console.log(JSON.stringify(defs.rows, null, 2));

  const trigger = await client.query(`
    SELECT tgname FROM pg_trigger WHERE tgname = 'trg_clear_user_accounts_client_id'
  `);
  console.log("=== Trigger present ===", trigger.rows.length === 1);

  console.log("=== SET NULL sanity (transaction rolled back) ===");
  await client.query("BEGIN");

  try {
    const tenant = await client.query(
      "SELECT id FROM tenants ORDER BY created_at NULLS LAST LIMIT 1",
    );
    const tenantId = tenant.rows[0].id;
    const clientId = "__patch_test_client__";

    await client.query(
      `INSERT INTO customers (tenant_id, client_id, client_name)
       VALUES ($1, $2, 'Patch Test Client')
       ON CONFLICT DO NOTHING`,
      [tenantId, clientId],
    );

    const ua = await client.query(
      `SELECT auth_uid, tenant_id, client_id FROM user_accounts
       WHERE tenant_id = $1 AND client_id IS NULL
       LIMIT 1`,
      [tenantId],
    );

    if (!ua.rows[0]) {
      console.log("SET NULL test skipped: no user_accounts row with NULL client_id");
    } else {
      const authUid = ua.rows[0].auth_uid;
      const tenantBefore = ua.rows[0].tenant_id;

      await client.query(
        `UPDATE user_accounts SET client_id = $1
         WHERE auth_uid = $2 AND tenant_id = $3`,
        [clientId, authUid, tenantId],
      );

      await client.query(
        `DELETE FROM customers WHERE tenant_id = $1 AND client_id = $2`,
        [tenantId, clientId],
      );

      const after = await client.query(
        `SELECT tenant_id, client_id FROM user_accounts
         WHERE auth_uid = $1`,
        [authUid],
      );

      console.log("tenant_id before delete:", tenantBefore);
      console.log("tenant_id after delete:", after.rows[0]?.tenant_id);
      console.log("client_id after delete:", after.rows[0]?.client_id);

      const ok =
        after.rows[0]?.tenant_id === tenantBefore &&
        after.rows[0]?.client_id === null;
      console.log(ok ? "PASS: client_id nulled, tenant_id intact" : "FAIL: unexpected values");
    }
  } finally {
    await client.query("ROLLBACK");
    console.log("Sanity transaction rolled back.");
  }
} finally {
  await client.end();
}

console.log("DONE");
