import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

async function main() {
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/310_supplier_contracts.sql"),
    "utf8",
  );
  const { client, envFile } = await connectPg({ envFiles: [".env.staging.local"] });
  console.log(`Connected via ${envFile}`);
  try {
    await client.query(sql);
    console.log("OK: applied scripts/310_supplier_contracts.sql");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
