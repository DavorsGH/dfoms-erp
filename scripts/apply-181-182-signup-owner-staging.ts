/**
 * Apply scripts 181 + 182 on staging.
 *
 * Usage: npx tsx scripts/apply-181-182-signup-owner-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const SCRIPTS = [
  "181_leave_approver_tenant_scope.sql",
  "182_signup_owner_employee_backfill.sql",
] as const;

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
  });
  console.log(`Connected using ${envFile}`);

  try {
    for (const script of SCRIPTS) {
      const sql = readFileSync(resolve(process.cwd(), "scripts", script), "utf8");
      console.log(`\n=== Applying ${script} ===`);
      await client.query(sql);
      console.log(`PASS ${script} applied`);
    }

    const fn = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'current_leave_approver_auth_uid'
    `);
    const def = String(fn.rows[0]?.def ?? "");
    if (!/current_user_tenant_id/i.test(def)) {
      throw new Error("current_leave_approver_auth_uid still not tenant-scoped");
    }
    console.log("\nPASS current_leave_approver_auth_uid is tenant-scoped");

    const pk = await client.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'approvers' AND c.contype = 'p'
    `);
    if (!String(pk.rows[0]?.def ?? "").includes("tenant_id")) {
      throw new Error("approvers PK is not composite with tenant_id");
    }
    console.log("PASS approvers PK includes tenant_id");

    const tenants = await client.query(`
      SELECT
        t.name,
        (SELECT COUNT(*)::int FROM employees e WHERE e.tenant_id = t.id) AS employees,
        (SELECT COUNT(*)::int FROM approvers a WHERE a.tenant_id = t.id) AS approvers,
        (SELECT COUNT(*)::int FROM leave_approver_config lac WHERE lac.tenant_id = t.id) AS leave_approvers
      FROM tenants t
      ORDER BY t.name
    `);
    console.log("\n=== Tenant summary after apply ===");
    for (const row of tenants.rows) {
      console.log(
        `${row.name}: employees=${row.employees}, approvers=${row.approvers}, leave_approvers=${row.leave_approvers}`,
      );
    }
  } finally {
    await client.end();
  }

  console.log("\nALL PASS — scripts 181/182 applied on staging");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
