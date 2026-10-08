// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const EXPENSE_ID = "50bd2bf5-fb51-4fb3-874b-8e8f3028ee48";

function loadEnv(f) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const { client } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local"],
  });
  await client.query(
    `DELETE FROM tax_ledger_entries WHERE source_id::text = $1`,
    [EXPENSE_ID],
  );
  const r = await client.query(`DELETE FROM expense_register WHERE id = $1`, [
    EXPENSE_ID,
  ]);
  await client.end();
  console.log("deleted rows", r.rowCount);
}

main();
