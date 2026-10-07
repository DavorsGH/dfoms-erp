/**
 * Re-apply scripts/373_salary_advance_mutations.sql on staging (month picker parse fix).
 * npx tsx scripts/staging-only/apply-373-salary-advance-month-parse-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "../lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`Connected via ${envFile}`);
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/373_salary_advance_mutations.sql"),
    "utf8",
  );
  console.log("Applying 373 (salary advance RPC month parse)…");
  await client.query(sql);
  console.log("373 applied.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
