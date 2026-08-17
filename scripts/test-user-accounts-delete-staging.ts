/**
 * Staging: create a disposable user, verify delete-dependencies + delete.
 *
 *   npx tsx scripts/test-user-accounts-delete-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import {
  deleteUserAccount,
  getUserDeleteDependencyReport,
  validateUserCanBeDeleted,
} from "../utils/admin-user-delete";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const PASSWORD = "DeleteTest-Staging-8Qx!";

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes(STAGING_REF), "Refusing: not staging");

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const stamp = Date.now().toString(36);
  const email = `delete-ui-test-${stamp}@test.davors`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  assert(!createError && created.user, createError?.message ?? "auth create failed");

  const authUid = created.user.id;

  const { error: accountError } = await admin.from("user_accounts").insert({
    tenant_id: DAVORS,
    auth_uid: authUid,
    email,
    role: "sales_rep",
    is_active: true,
    employee_id: null,
    client_id: null,
  });
  assert(!accountError, accountError?.message ?? "user_accounts insert failed");

  console.log("Created test user:", email, authUid);

  const report = await getUserDeleteDependencyReport(admin, authUid, DAVORS);
  assert(report, "dependency report missing");
  console.log("Dependency report:", report);

  const validation = await validateUserCanBeDeleted(admin, authUid, DAVORS);
  assert(validation.ok, `expected deletable, got ${validation.ok ? "ok" : validation.reason}`);

  const deleted = await deleteUserAccount(admin, authUid, DAVORS);
  assert(deleted.ok, deleted.ok ? "" : deleted.error);

  const { data: gone } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("auth_uid", authUid)
    .maybeSingle();
  assert(!gone, "user_accounts row still exists");

  console.log("PASS: delete-dependencies + delete for", email);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
