/**
 * STAGING ONLY — Davors test tenant data hygiene (not a production migration).
 * npx tsx scripts/staging-only/apply-davors-staging-data-fixes.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "../lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function runSqlFile(client: import("pg").Client, relativePath: string) {
  const sql = readFileSync(resolve(process.cwd(), relativePath), "utf8");
  console.log(`Applying ${relativePath} …`);
  await client.query(sql);
}

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`Staging-only Davors fixes (${envFile}, ref ${STAGING_REF})\n`);

  await runSqlFile(
    client,
    "scripts/staging-only/davors-retag-directors-loan-technologies-to-facilities.sql",
  );
  await runSqlFile(
    client,
    "scripts/staging-only/davors-fix-director-loan-manual-proceeds.sql",
  );
  await runSqlFile(
    client,
    "scripts/staging-only/davors-delete-sku1003-phantom-null-balance.sql",
  );

  console.log("\nDone.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
