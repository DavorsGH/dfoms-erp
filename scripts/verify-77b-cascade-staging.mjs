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

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: resolveDatabaseUrl(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  await client.query("BEGIN");

  const tenant = await client.query(
    "SELECT id FROM tenants ORDER BY created_at NULLS LAST LIMIT 1",
  );
  const tenantId = tenant.rows[0].id;
  const siteCode = "__patch_test_site__";
  const clientId = "__patch_test_client2__";

  await client.query(
    `INSERT INTO customers (tenant_id, client_id, client_name)
     VALUES ($1, $2, 'Patch Test Client 2')
     ON CONFLICT DO NOTHING`,
    [tenantId, clientId],
  );
  await client.query(
    `INSERT INTO sites (tenant_id, site_code, site_name, client_id)
     VALUES ($1, $2, 'Patch Test Site', $3)
     ON CONFLICT DO NOTHING`,
    [tenantId, siteCode, clientId],
  );

  const sup = await client.query(
    "SELECT auth_uid FROM user_accounts WHERE tenant_id = $1 LIMIT 1",
    [tenantId],
  );

  await client.query(
    `INSERT INTO user_account_supervisor_sites (auth_uid, tenant_id, site_code)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [sup.rows[0].auth_uid, tenantId, siteCode],
  );

  const before = await client.query(
    `SELECT count(*)::int AS c FROM user_account_supervisor_sites
     WHERE tenant_id = $1 AND site_code = $2`,
    [tenantId, siteCode],
  );

  await client.query(
    "DELETE FROM sites WHERE tenant_id = $1 AND site_code = $2",
    [tenantId, siteCode],
  );

  const after = await client.query(
    `SELECT count(*)::int AS c FROM user_account_supervisor_sites
     WHERE tenant_id = $1 AND site_code = $2`,
    [tenantId, siteCode],
  );

  console.log(
    "CASCADE test supervisor rows before/after site delete:",
    before.rows[0].c,
    "->",
    after.rows[0].c,
  );
} finally {
  await client.query("ROLLBACK");
  console.log("Transaction rolled back.");
  await client.end();
}
