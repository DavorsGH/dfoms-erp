/**
 * Apply scripts/219_security_notification_dismissals.sql to production.
 *
 * Usage: npx tsx scripts/apply-219-security-notification-dismissals-production.ts
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

  const scriptName = "219_security_notification_dismissals.sql";
  const sql = readFileSync(resolve(process.cwd(), "scripts", scriptName), "utf8");

  try {
    await client.query(sql);
    console.log(`OK: applied scripts/${scriptName} on production`);

    const { rows: tableRow } = await client.query(
      "SELECT to_regclass('public.security_notification_dismissals') AS reg",
    );
    console.log("Table:", tableRow[0]?.reg ?? "(missing)");

    const { rows: constraintRows } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.security_notification_dismissals'::regclass
        AND conname = 'security_notification_dismissals_nudge_type_check'
    `);
    console.log("nudge_type check:", constraintRows[0]?.def ?? "(missing)");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
