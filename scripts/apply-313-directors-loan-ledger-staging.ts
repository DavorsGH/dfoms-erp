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
    resolve(process.cwd(), "scripts/313_directors_loan_entries.sql"),
    "utf8",
  );
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query(sql);
  const check = await client.query(
    `SELECT to_regclass('public.directors_loan_entries') AS tbl`,
  );
  console.log("directors_loan_entries:", check.rows[0]?.tbl ?? "MISSING");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
