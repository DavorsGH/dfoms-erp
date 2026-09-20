/**
 * Read-only supplement: auth.users metadata + employee search for avorsjason@gmail.com
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import pg from "pg";

for (const envFile of [".env.production.local", ".env.local"]) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), envFile), "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch {
    // optional
  }
}

async function main() {
  const url = process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Missing PRODUCTION_DATABASE_URL or DATABASE_URL");

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const email = "avorsjason@gmail.com";

  const auth = await client.query(
    `SELECT id, email, raw_user_meta_data, created_at, last_sign_in_at
     FROM auth.users WHERE lower(email) = lower($1)`,
    [email],
  );
  console.log("auth.users for avorsjason@gmail.com:");
  console.log(JSON.stringify(auth.rows, null, 2));

  const ua = await client.query(
    `SELECT ua.*, t.name AS tenant_name
     FROM user_accounts ua
     LEFT JOIN tenants t ON t.id = ua.tenant_id
     WHERE lower(ua.email) = lower($1)`,
    [email],
  );
  console.log("\nuser_accounts + tenant:");
  console.log(JSON.stringify(ua.rows, null, 2));

  const empByEmail = await client.query(
    `SELECT employee_id, staff_id, full_name, email, employment_status, tenant_id
     FROM employees
     WHERE lower(email) ILIKE '%avorsjason%'
        OR lower(full_name) ILIKE '%jason%avors%'
        OR lower(full_name) ILIKE '%avors%jason%'`,
  );
  console.log("\nemployees name/email search (jason/avors):");
  console.log(JSON.stringify(empByEmail.rows, null, 2));

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
