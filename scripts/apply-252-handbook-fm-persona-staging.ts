/**
 * Apply scripts/252_handbook_chunks_facility_manager_persona.sql on staging.
 * Usage: npx tsx scripts/apply-252-handbook-fm-persona-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

async function main() {
  const file = "scripts/252_handbook_chunks_facility_manager_persona.sql";
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
      WHERE conname = 'handbook_chunks_persona_check'
    `);
    console.log("persona CHECK:", rows[0]?.def ?? "(missing)");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
