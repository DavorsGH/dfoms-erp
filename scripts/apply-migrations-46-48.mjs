import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function applySql(filename) {
  const databaseUrl = resolveDatabaseUrl();

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL (or SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL) is required in .env.local to apply migrations.",
    );
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const sql = readFileSync(resolve(process.cwd(), "scripts", filename), "utf8");
    console.log(`Applying ${filename}...`);
    await client.query(sql);
    console.log(`Applied ${filename}`);
  } finally {
    await client.end();
  }
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  await applySql("46_cascade_delete_and_purchase_rpcs.sql");
  await applySql("48_rbac_page_access.sql");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
