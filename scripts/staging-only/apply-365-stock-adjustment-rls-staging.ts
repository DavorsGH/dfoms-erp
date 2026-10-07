/**
 * Staging only: re-apply 365 (register link RLS + SECURITY DEFINER posting).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "../lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/365_inventory_stock_adjustment_balancing.sql"),
    "utf8",
  );
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });
  console.log(`Connected via ${envFile}`);
  console.log("Applying 365 on staging…");
  await client.query(sql);
  console.log("365 applied.");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
