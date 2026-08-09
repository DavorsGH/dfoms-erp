/**
 * Read-only probe for approvers / leave_approver_config / tenant employee counts.
 * Usage: npx tsx scripts/probe-signup-owner-staging.ts
 */
import { connectPg } from "./lib/pg-connect";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
  });
  console.log(`Connected using ${envFile}`);

  const constraints = await client.query(`
    SELECT conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'approvers'
  `);
  console.log("\napprovers constraints:", JSON.stringify(constraints.rows, null, 2));

  const approverCols = await client.query(`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'approvers'
    ORDER BY ordinal_position
  `);
  console.log("\napprovers columns:", JSON.stringify(approverCols.rows, null, 2));

  const lacCols = await client.query(`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leave_approver_config'
    ORDER BY ordinal_position
  `);
  console.log("\nleave_approver_config columns:", JSON.stringify(lacCols.rows, null, 2));

  const tenants = await client.query(`
    SELECT
      t.id,
      t.name,
      (SELECT COUNT(*)::int FROM employees e WHERE e.tenant_id = t.id) AS employee_count,
      (SELECT COUNT(*)::int FROM approvers a WHERE a.tenant_id = t.id) AS approver_count,
      (SELECT COUNT(*)::int FROM leave_approver_config lac WHERE lac.tenant_id = t.id) AS leave_approver_count,
      (
        SELECT ua.auth_uid
        FROM user_accounts ua
        WHERE ua.tenant_id = t.id
          AND ua.role = 'super_admin'
          AND ua.is_active IS NOT FALSE
        ORDER BY ua.email
        LIMIT 1
      ) AS super_admin_auth_uid
    FROM tenants t
    ORDER BY t.name
  `);
  console.log("\ntenant summary:", JSON.stringify(tenants.rows, null, 2));

  const fn = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_leave_approver_auth_uid'
  `);
  console.log("\ncurrent_leave_approver_auth_uid:", fn.rows[0]?.def ?? "NOT FOUND");

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
