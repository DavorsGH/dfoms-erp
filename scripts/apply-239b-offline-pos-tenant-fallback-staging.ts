/**
 * Apply scripts/239b_offline_pos_tenant_fallback.sql to staging only.
 *
 *   npx tsx scripts/apply-239b-offline-pos-tenant-fallback-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });
  console.log(`Connected via ${envFile}`);
  try {
    const sql = readFileSync(
      resolve(process.cwd(), "scripts/239b_offline_pos_tenant_fallback.sql"),
      "utf8",
    );
    await client.query(sql);
    console.log("PASS applied 239b offline POS tenant fallback on staging");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
