/**
 * Read-only: list products where master current_stock != sum(balances).
 *
 * npx tsx scripts/audits/run-finished-products-master-stock-audit.ts --env-file .env.local.production-backup-2026-08-25
 * npx tsx scripts/audits/run-finished-products-master-stock-audit.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "../lib/pg-connect";

function parseEnvArg(): string[] {
  const i = process.argv.indexOf("--env-file");
  if (i === -1) {
    return [".env.staging.local", ".env.local"];
  }
  return [process.argv[i + 1] ?? ".env.staging.local"];
}

async function main() {
  const envFiles = parseEnvArg();
  const { client, envFile } = await connectPg({ envFiles });
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/audits/finished_products_master_vs_balance_sums.sql"),
    "utf8",
  );
  console.log(`Master vs balance sums (${envFile})\n`);
  const { rows } = await client.query(sql);
  console.log(`Mismatch rows: ${rows.length}`);
  if (rows.length) {
    console.log(JSON.stringify(rows, null, 2));
  }
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
