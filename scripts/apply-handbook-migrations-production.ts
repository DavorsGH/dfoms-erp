/**
 * Apply handbook RAG schema (231, 232, 233) to production Postgres.
 *
 *   ALLOW_PRODUCTION_SCHEMA=true npx tsx scripts/apply-handbook-migrations-production.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const SQL_FILES = [
  "231_handbook_chunks.sql",
  "232_handbook_match_rpc.sql",
  "233_handbook_screenshots.sql",
] as const;

async function main() {
  if (process.env.ALLOW_PRODUCTION_SCHEMA !== "true") {
    throw new Error("Set ALLOW_PRODUCTION_SCHEMA=true to apply handbook migrations on production.");
  }

  const { client, envFile } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local.backup", ".env.vercel.production.local"],
  });
  console.log(`Connected via ${envFile}`);

  try {
    for (const file of SQL_FILES) {
      const sql = readFileSync(resolve(process.cwd(), "scripts", file), "utf8");
      console.log(`Applying ${file} …`);
      await client.query(sql);
    }

    const { rows: chunkTable } = await client.query(
      `SELECT to_regclass('public.handbook_chunks') AS tbl`,
    );
    const { rows: screenshotTable } = await client.query(
      `SELECT to_regclass('public.handbook_screenshots') AS tbl`,
    );
    const { rows: rpc } = await client.query(`
      SELECT proname FROM pg_proc
      WHERE proname = 'match_handbook_chunks'
        AND pronamespace = 'public'::regnamespace
    `);
    const { rows: bucket } = await client.query(`
      SELECT id, public FROM storage.buckets WHERE id = 'handbook-screenshots'
    `);

    console.log("handbook_chunks:", chunkTable[0]?.tbl ?? "missing");
    console.log("handbook_screenshots:", screenshotTable[0]?.tbl ?? "missing");
    console.log("match_handbook_chunks:", rpc.length ? "present" : "missing");
    console.log("handbook-screenshots bucket:", bucket[0] ?? "missing");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
