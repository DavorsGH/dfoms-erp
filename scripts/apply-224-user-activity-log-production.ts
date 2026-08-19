/**
 * Apply scripts/224_user_activity_log.sql to production.
 * Usage: npx tsx scripts/apply-224-user-activity-log-production.ts --allow-production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

async function main() {
  const allowProduction = process.argv.includes("--allow-production");
  if (!allowProduction) {
    throw new Error("Pass --allow-production to apply on production.");
  }

  const sql = readFileSync(
    resolve(process.cwd(), "scripts/224_user_activity_log.sql"),
    "utf8",
  );

  const { client, envFile, candidateIndex } = await connectPg({
    envFiles: [".env.local.backup", ".env.vercel.production.local"],
    requiredProjectRef: PRODUCTION_REF,
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  try {
    await client.query(sql);
    console.log("OK: applied scripts/224_user_activity_log.sql on production");

    const { rows: tableRows } = await client.query(
      "SELECT to_regclass('public.user_activity_log') AS tbl",
    );
    console.log("Table exists:", tableRows[0]?.tbl);

    const { rows: policyRows } = await client.query(
      "SELECT policyname, cmd, roles::text FROM pg_policies WHERE tablename = 'user_activity_log' ORDER BY policyname",
    );
    console.log("Policies:");
    for (const row of policyRows) {
      console.log(`  - ${row.policyname} (${row.cmd}, roles=${row.roles})`);
    }

    const { rows: grantRows } = await client.query(`
      SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'user_activity_log'
      ORDER BY grantee, privilege_type
    `);
    console.log("Grants:");
    for (const row of grantRows) {
      console.log(`  - ${row.grantee}: ${row.privilege_type}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
