/**
 * Apply scripts/222_landlords_suspended_approval_status.sql to staging.
 *
 *   npx tsx scripts/apply-222-landlords-suspended-staging.ts --env-file .env.staging.local
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
    resolve("scripts/222_landlords_suspended_approval_status.sql"),
    "utf8",
  );

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conname = 'landlords_approval_status_check'`,
    );
    console.log("Applied 222_landlords_suspended_approval_status.sql to staging");
    console.log(rows[0]?.def ?? "(constraint not found)");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
