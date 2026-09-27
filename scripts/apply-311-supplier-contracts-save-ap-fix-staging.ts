import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

async function listSaveApSignatures(client: import("pg").Client) {
  const { rows } = await client.query(`
    SELECT pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'save_accounts_payable'
    ORDER BY 1
  `);
  return rows.map((r: { args: string }) => r.args);
}

async function main() {
  const { client, envFile } = await connectPg({ envFiles: [".env.staging.local"] });
  console.log(`Connected via ${envFile}`);
  const before = await listSaveApSignatures(client);
  console.log("save_accounts_payable BEFORE:", before.length ? before : "(none)");
  for (const sig of before) {
    console.log(`  - save_accounts_payable(${sig})`);
  }

  const sql = readFileSync(
    resolve(process.cwd(), "scripts/311_supplier_contracts_save_ap_fix.sql"),
    "utf8",
  );
  try {
    await client.query(sql);
    const after = await listSaveApSignatures(client);
    console.log("save_accounts_payable AFTER:", after.length ? after : "(none)");
    for (const sig of after) {
      console.log(`  - save_accounts_payable(${sig})`);
    }
    if (after.length !== 1) {
      throw new Error(`Expected exactly 1 save_accounts_payable signature, got ${after.length}`);
    }
    console.log("OK: applied scripts/311_supplier_contracts_save_ap_fix.sql");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
