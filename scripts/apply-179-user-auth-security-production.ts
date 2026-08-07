/**
 * Apply user_auth_security (script 179) to production.
 * Usage: npx tsx scripts/apply-179-user-auth-security-production.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

async function main() {
  const { client, envFile, candidateIndex } = await connectPg({
    envFiles: [".env.local.backup"],
    requiredProjectRef: "tvcurcnmasnocwdxzgvz",
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  const scriptName = "179_user_auth_security.sql";
  const sql = readFileSync(resolve(process.cwd(), "scripts", scriptName), "utf8");

  try {
    await client.query(sql);
    console.log(`OK: applied scripts/${scriptName} on production`);

    const { rows } = await client.query(
      "SELECT COUNT(*)::int AS n FROM public.user_auth_security",
    );
    console.log("user_auth_security rows:", rows[0]?.n ?? 0);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
