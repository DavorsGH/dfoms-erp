import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

function resolveEnvFile(argv) {
  const idx = argv.indexOf("--env-file");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return ".env.staging.local";
}

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

async function main() {
  const envFile = resolveEnvFile(process.argv.slice(2));
  console.log(`Using env file: ${envFile}`);
  loadEnvForce(resolve(process.cwd(), envFile));
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required in env file to apply migrations.");
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const sql = readFileSync(
      resolve(process.cwd(), "scripts", "220_landlord_subscriptions_annual_billing.sql"),
      "utf8",
    );

    console.log("Applying 220_landlord_subscriptions_annual_billing.sql...");
    await client.query(sql);
    console.log("Applied.");

    const migration221 = readFileSync(
      resolve(process.cwd(), "scripts", "221_landlord_subscriptions_platform_tier.sql"),
      "utf8",
    );
    console.log("Applying 221_landlord_subscriptions_platform_tier.sql...");
    await client.query(migration221);
    console.log("Applied 221.");

    const columns = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'landlord_subscriptions'
        AND column_name IN ('billing_cycle', 'pending_billing_cycle')
      ORDER BY column_name
    `);

    const annualConfig = await client.query(`
      SELECT config_key, price_ghs
      FROM platform_billing_config
      WHERE config_key = 'platform_only_unit_annual'
    `);

    const triggerCheck = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = 'landlord_unit_activation_charges_trigger_type_check'
    `);

    console.log("\n=== landlord_subscriptions new columns ===");
    console.log(JSON.stringify(columns.rows, null, 2));
    console.log("\n=== platform_only_unit_annual config ===");
    console.log(JSON.stringify(annualConfig.rows, null, 2));
    console.log("\n=== trigger_type CHECK ===");
    console.log(JSON.stringify(triggerCheck.rows, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
