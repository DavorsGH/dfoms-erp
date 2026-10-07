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
    resolve(
      process.cwd(),
      "scripts/staging-only/salary_advance_register_rls_tenant_scope_backfill.sql",
    ),
    "utf8",
  );
  await client.query(sql);
  console.log("Salary advance RLS tenant-scope backfill applied (staging-only).");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
