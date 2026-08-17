/**
 * Probe staging delete-dependencies queries for all Davors user accounts.
 *
 *   npx tsx scripts/_probe-delete-deps-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import {
  getUserDeleteDependencyReport,
  validateUserCanBeDeleted,
} from "../utils/admin-user-delete";
import { loadEnvFromArgv } from "./lib/env";

const DAVORS = "00000001-0000-4000-8000-000000000001";

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  for (const table of ["leave_approver_config", "leave_requests"]) {
    const { data, error } = await admin.from(table).select("tenant_id").limit(1);
    console.log(`${table} tenant_id column:`, error ? error.message : "OK", data?.length ?? 0);
  }

  const { data: accounts } = await admin
    .from("user_accounts")
    .select("auth_uid, email, role")
    .eq("tenant_id", DAVORS);

  console.log("\nDavors accounts:", accounts?.length ?? 0);

  for (const acct of accounts ?? []) {
    const queries = await Promise.all([
      admin
        .from("user_account_supervisor_sites")
        .select("site_code", { count: "exact", head: true })
        .eq("auth_uid", acct.auth_uid)
        .eq("tenant_id", DAVORS),
      admin
        .from("leave_approver_config")
        .select("id", { count: "exact", head: true })
        .eq("approver_user_account_id", acct.auth_uid)
        .eq("tenant_id", DAVORS),
      admin
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("approver_user_account_id", acct.auth_uid)
        .eq("tenant_id", DAVORS)
        .eq("status", "Pending"),
      admin
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("approver_user_account_id", acct.auth_uid)
        .eq("tenant_id", DAVORS),
    ]);

    const queryErrors = queries
      .map((q, i) => (q.error ? `[${i}] ${q.error.message}` : null))
      .filter(Boolean);

    const report = await getUserDeleteDependencyReport(admin, acct.auth_uid, DAVORS);
    const validation = await validateUserCanBeDeleted(admin, acct.auth_uid, DAVORS);

    console.log(`\n${acct.email} (${acct.role})`);
    if (queryErrors.length) console.log("  QUERY ERRORS:", queryErrors);
    console.log("  report:", report);
    console.log("  canDelete:", validation.ok, validation.ok ? "" : validation.reason);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
