/**
 * Apply scripts/312_expense_register_reject_fixed_assets_category.sql on staging.
 *
 *   npx tsx scripts/apply-312-expense-register-guard-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { loadEnvForce } from "./lib/env";

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii")) {
    throw new Error("Refusing non-staging DATABASE_URL");
  }
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/312_expense_register_reject_fixed_assets_category.sql"),
    "utf8",
  );
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(sql);
  const check = await client.query(
    `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_expense_register_reject_fixed_assets_insert'`,
  );
  console.log("Trigger:", check.rows[0]?.tgname ?? "MISSING");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
