/**
 * Apply scripts/252_handbook_chunks_facility_manager_persona.sql on production.
 *
 *   ALLOW_PRODUCTION_SCHEMA=true npx tsx scripts/apply-252-handbook-fm-persona-production.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

async function main() {
  if (process.env.ALLOW_PRODUCTION_SCHEMA !== "true") {
    throw new Error(
      "Set ALLOW_PRODUCTION_SCHEMA=true to apply 252 on production.",
    );
  }

  const file = "scripts/252_handbook_chunks_facility_manager_persona.sql";
  const { client, envFile, candidateIndex } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local.backup", ".env.vercel.production.local"],
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  try {
    const sql = readFileSync(resolve(process.cwd(), file), "utf8");
    await client.query(sql);
    console.log(`OK: applied ${file} on production`);

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
