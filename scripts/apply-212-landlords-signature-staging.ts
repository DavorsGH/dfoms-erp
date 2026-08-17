/**
 * Apply scripts/212_landlords_signature_url.sql to staging.
 *
 *   npx tsx scripts/apply-212-landlords-signature-staging.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (!supabaseUrl.includes(STAGING_REF)) {
    throw new Error("Expected staging Supabase URL in env");
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL required");
  }

  const sql = readFileSync(
    resolve("scripts/212_landlords_signature_url.sql"),
    "utf8",
  );

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'landlords'
         AND column_name IN ('signature_url', 'signature_author_name', 'signature_author_title')
       ORDER BY column_name`,
    );
    console.log("Applied 212_landlords_signature_url.sql to staging");
    console.log("landlords signature columns:", rows);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
