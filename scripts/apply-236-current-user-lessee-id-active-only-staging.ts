/**
 * Apply scripts/236_current_user_lessee_id_active_only.sql to staging.
 *
 *   npx tsx scripts/apply-236-current-user-lessee-id-active-only-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });
  console.log(`Connected via ${envFile}`);

  try {
    const sql = readFileSync(
      resolve(process.cwd(), "scripts/236_current_user_lessee_id_active_only.sql"),
      "utf8",
    );
    console.log("Applying 236_current_user_lessee_id_active_only.sql …");
    await client.query(sql);

    const { rows } = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'current_user_lessee_id'
      ORDER BY p.oid DESC
      LIMIT 1
    `);
    const def = String(rows[0]?.def ?? "");
    if (!def.includes("former")) {
      throw new Error("Expected current_user_lessee_id to filter former status");
    }
    console.log("PASS: current_user_lessee_id filters former status.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
