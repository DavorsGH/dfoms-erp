/**
 * Apply scripts/247 + 248 to staging (activity persona + facility_managers RLS).
 * Usage: npx tsx scripts/apply-247-248-facility-manager-portal-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

async function main() {
  const files = [
    "scripts/247_facility_manager_activity_persona.sql",
    "scripts/248_facility_managers_table_rls.sql",
  ];

  const { client, envFile, candidateIndex } = await connectPg({
    envFiles: [".env.staging.local"],
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  try {
    for (const file of files) {
      const sql = readFileSync(resolve(process.cwd(), file), "utf8");
      await client.query(sql);
      console.log(`OK: applied ${file} on staging`);
    }

    const { rows: policies } = await client.query(`
      SELECT policyname
      FROM pg_policies
      WHERE tablename = 'facility_managers'
      ORDER BY policyname
    `);
    console.log(
      "facility_managers policies:",
      policies.map((r) => r.policyname).join(", ") || "(none)",
    );

    const { rows: check } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = 'user_activity_log_persona_check'
    `);
    console.log("user_activity_log_persona_check:", check[0]?.def ?? "(missing)");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
