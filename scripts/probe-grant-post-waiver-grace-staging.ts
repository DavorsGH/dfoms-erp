/**
 * Inspect grant_post_waiver_grace_period() on staging.
 *
 *   npx tsx scripts/probe-grant-post-waiver-grace-staging.ts
 */
import { resolve } from "node:path";
import pg from "pg";
import { loadEnvForce } from "./lib/env";

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

async function main() {
  const dbUrl =
    process.env.DATABASE_URL?.trim() || process.env.SUPABASE_DB_URL?.trim();
  if (!dbUrl) {
    throw new Error("No DATABASE_URL or SUPABASE_DB_URL in .env.staging.local");
  }

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const fn = await client.query<{ definition: string }>(`
      SELECT pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'grant_post_waiver_grace_period'
      ORDER BY p.oid
      LIMIT 1
    `);

    if (fn.rows.length === 0) {
      console.log("FUNCTION NOT FOUND on staging");
      return;
    }

    const def = fn.rows[0].definition;
    console.log("=== STAGING grant_post_waiver_grace_period() ===");
    console.log(def);
    console.log("\n=== COLUMN REFERENCES ===");
    console.log("trial_ends_at:", def.includes("trial_ends_at") ? "YES" : "NO");
    console.log(
      "trial_end_date:",
      def.includes("trial_end_date") ? "YES" : "NO",
    );

    const cols = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'crm_subscriptions'
        AND column_name IN ('trial_ends_at', 'trial_end_date')
      ORDER BY column_name
    `);
    console.log("\n=== crm_subscriptions trial columns on staging ===");
    console.log(
      cols.rows.map((row) => row.column_name).join(", ") || "(none matched)",
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
