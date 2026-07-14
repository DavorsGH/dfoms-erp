import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function queryInformationSchema(client, tableName, columnName) {
  const result = await client.query(
    `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    `,
    [tableName, columnName],
  );
  return result.rows[0] ?? null;
}

async function probeViaSupabase(supabase, tableName) {
  const { error } = await supabase.from(tableName).select("is_archived").limit(1);
  return error ? error.message : "column exists";
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const databaseUrl =
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL;

  console.log("Checking is_archived on raw_materials and finished_products...\n");

  if (databaseUrl) {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      for (const table of ["raw_materials", "finished_products"]) {
        const row = await queryInformationSchema(client, table, "is_archived");
        console.log(
          `information_schema ${table}.is_archived:`,
          row ? JSON.stringify(row) : "NOT FOUND",
        );
      }
    } finally {
      await client.end();
    }
  } else {
    console.log("DATABASE_URL not set — falling back to Supabase select probe.");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    for (const table of ["raw_materials", "finished_products"]) {
      const message = await probeViaSupabase(supabase, table);
      console.log(`supabase probe ${table}.is_archived:`, message);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
