/**
 * Apply scripts/223_staff_portal_invites.sql to staging.
 *
 *   npx tsx scripts/apply-223-staff-portal-invites-staging.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";
import { loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  loadEnvFromArgv(process.argv.slice(2));

  const sql = readFileSync(
    resolve("scripts/223_staff_portal_invites.sql"),
    "utf8",
  );

  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
  });

  try {
    await client.query(sql);

    const { rows: tableRows } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('staff_portal_invites', 'staff_portal_invite_supervisor_sites')
      ORDER BY table_name
    `);

    const { rows: policyRows } = await client.query(`
      SELECT tablename, policyname, roles
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('staff_portal_invites', 'staff_portal_invite_supervisor_sites')
      ORDER BY tablename, policyname
    `);

    console.log(`Applied 223_staff_portal_invites.sql via ${envFile}`);
    console.log("Tables:", tableRows.map((r) => r.table_name).join(", "));
    console.log(
      "RLS policies:",
      policyRows
        .map((r) => `${r.tablename}.${r.policyname} → ${r.roles}`)
        .join("; "),
    );
    console.log(
      "\nVerify in Supabase SQL Editor (new tab):\n" +
        "  SELECT invite_id, tenant_id, email, role, expires_at, used_at\n" +
        "  FROM staff_portal_invites LIMIT 5;",
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
