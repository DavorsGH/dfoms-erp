/**
 * Apply scripts/251 to staging (lessee_complaints.raised_by includes facility_manager).
 * Usage: npx tsx scripts/apply-251-lessee-complaints-raised-by-fm-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

async function main() {
  const file = "scripts/251_lessee_complaints_raised_by_facility_manager.sql";
  const { client, envFile, candidateIndex } = await connectPg({
    envFiles: [".env.staging.local"],
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  try {
    const sql = readFileSync(resolve(process.cwd(), file), "utf8");
    await client.query(sql);
    console.log(`OK: applied ${file} on staging`);

    const { rows } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = 'lessee_complaints_raised_by_check'
    `);
    console.log("raised_by CHECK:", rows[0]?.def ?? "(missing)");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
