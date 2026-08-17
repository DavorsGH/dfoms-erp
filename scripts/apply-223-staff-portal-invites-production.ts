/**
 * Apply scripts/223_staff_portal_invites.sql to production and verify MFA foundation tables.
 *
 *   npx tsx scripts/apply-223-staff-portal-invites-production.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const MFA_TABLES = [
  "user_mfa_settings",
  "login_sms_otp_challenges",
  "login_mfa_sessions",
] as const;

async function main() {
  const { client, envFile } = await connectPg({
    envFiles: [".env.local.backup", ".env.local"],
    requiredProjectRef: PRODUCTION_REF,
  });
  console.log(`Connected via ${envFile}`);

  try {
    for (const table of MFA_TABLES) {
      const { rows } = await client.query(
        `SELECT to_regclass($1) AS tbl,
                (SELECT COUNT(*)::int FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = $2) AS col_count`,
        [`public.${table}`, table],
      );
      const tbl = rows[0]?.tbl ?? "(missing)";
      const colCount = rows[0]?.col_count ?? 0;
      console.log(`MFA table ${table}: ${tbl} (${colCount} columns)`);
      if (!rows[0]?.tbl) {
        throw new Error(`Expected MFA table ${table} on production — apply 176-178 first`);
      }
      const sample = await client.query(`SELECT * FROM ${table} LIMIT 1`);
      console.log(`  SELECT * FROM ${table} LIMIT 1 → ${sample.rowCount} row(s)`);
    }

    const { rows: inviteTbl } = await client.query(
      "SELECT to_regclass('public.staff_portal_invites') AS tbl",
    );
    const had223 = Boolean(inviteTbl[0]?.tbl);
    console.log(
      `staff_portal_invites before 223: ${had223 ? "present" : "(missing)"}`,
    );

    if (!had223) {
      const sql = readFileSync(
        resolve("scripts/223_staff_portal_invites.sql"),
        "utf8",
      );
      await client.query(sql);
      console.log("Applied scripts/223_staff_portal_invites.sql");
    } else {
      console.log("223 already present — skipping apply");
    }

    const verify = await client.query(`
      SELECT invite_id, tenant_id, email, role, expires_at, used_at
      FROM staff_portal_invites
      LIMIT 5
    `);
    console.log(`staff_portal_invites sample query: ${verify.rowCount} row(s)`);

    const { rows: tables } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('staff_portal_invites', 'staff_portal_invite_supervisor_sites')
      ORDER BY table_name
    `);
    console.log("223 tables:", tables.map((r) => r.table_name).join(", "));

    const { rows: policies } = await client.query(`
      SELECT tablename, policyname, roles
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('staff_portal_invites', 'staff_portal_invite_supervisor_sites')
      ORDER BY tablename, policyname
    `);
    for (const p of policies) {
      console.log(`RLS ${p.tablename}.${p.policyname} → ${p.roles}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
