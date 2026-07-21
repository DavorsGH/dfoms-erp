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

const tenantId = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

function rebuildUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  parsed.password = encodeURIComponent(decodeURIComponent(parsed.password));
  return parsed.toString();
}

const candidates = [];
const rawUrl = process.env.DATABASE_URL;
if (rawUrl) {
  candidates.push(rawUrl, rebuildUrl(rawUrl));
}
if (process.env.SUPABASE_DB_PASSWORD && process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const password = process.env.SUPABASE_DB_PASSWORD;
  candidates.push(
    `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
  );
}

const { default: pg } = await import("pg");
let lastError;

for (const connectionString of [...new Set(candidates.filter(Boolean))]) {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    const supplierResult = await client.query(
      `
      INSERT INTO suppliers (name, contact_person, phone, payment_terms_days, tenant_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `,
      ["Test Supplier Ltd", "Kofi Mensah", "0244000000", 30, tenantId],
    );

    const productResult = await client.query(
      `
      INSERT INTO finished_products (product_code, product_name, unit_of_measure, current_stock, standard_selling_price, sourcing_type, tenant_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `,
      ["TESTP-001", "Test Purchased Item", "unit", 0, 50, "purchased", tenantId],
    );

    await client.query("COMMIT");
    await client.end();

    console.log(
      JSON.stringify(
        {
          supplier_id: supplierResult.rows[0].id,
          finished_product_id: productResult.rows[0].id,
          tenant_id: tenantId,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  } catch (error) {
    lastError = error;
    try {
      await client.query("ROLLBACK");
      await client.end();
    } catch {
      // ignore cleanup errors
    }
  }
}

throw lastError ?? new Error("No database connection candidate worked");
