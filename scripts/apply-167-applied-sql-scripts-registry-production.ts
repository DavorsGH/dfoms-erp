/**
 * Apply scripts/167_applied_sql_scripts_registry.sql to production.
 * Usage: npx tsx scripts/apply-167-applied-sql-scripts-registry-production.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

async function main() {
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/167_applied_sql_scripts_registry.sql"),
    "utf8",
  );

  const { client, envFile, candidateIndex } = await connectPg({
    envFiles: [".env.local.backup"],
    requiredProjectRef: "tvcurcnmasnocwdxzgvz",
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  try {
    await client.query(sql);
    console.log("OK: applied scripts/167_applied_sql_scripts_registry.sql on production");

    const { rows: tableRows } = await client.query(
      "SELECT to_regclass('public.applied_sql_scripts') AS tbl",
    );
    console.log("Table exists:", tableRows[0]?.tbl);

    const { rows: policyRows } = await client.query(
      "SELECT policyname FROM pg_policies WHERE tablename = 'applied_sql_scripts'",
    );
    console.log(
      "Policies:",
      policyRows.map((row) => row.policyname).join(", ") || "(none)",
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
