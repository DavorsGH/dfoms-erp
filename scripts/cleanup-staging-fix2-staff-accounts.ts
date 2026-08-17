/**
 * Delete staging fix2 regression test staff accounts (Davors tenant only).
 *
 *   npx tsx scripts/cleanup-staging-fix2-staff-accounts.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import {
  deleteUserAccount,
  validateUserCanBeDeleted,
} from "../utils/admin-user-delete";
import { loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_TENANT = "00000001-0000-4000-8000-000000000001";

const TARGET_EMAILS = [
  "fix2.staff.msu5n4fr@test.davors",
  "fix2.staff.msu5oxi3@test.davors",
  "fix2.staff.msu5rqc3@test.davors",
  "fix2.staff.msu5ty26@test.davors",
];

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING_REF)) {
    throw new Error("Refusing: not staging");
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  for (const email of TARGET_EMAILS) {
    const { data: account } = await admin
      .from("user_accounts")
      .select("auth_uid, email, role, is_active")
      .eq("tenant_id", DAVORS_TENANT)
      .ilike("email", email)
      .maybeSingle();

    if (!account) {
      console.log(`SKIP (not found): ${email}`);
      continue;
    }

    const validation = await validateUserCanBeDeleted(
      admin,
      account.auth_uid,
      DAVORS_TENANT,
    );
    if (!validation.ok) {
      console.log(`BLOCKED: ${email} — ${validation.reason}`);
      continue;
    }

    const result = await deleteUserAccount(
      admin,
      account.auth_uid,
      DAVORS_TENANT,
    );
    console.log(
      result.ok
        ? `DELETED: ${email} (${account.auth_uid})`
        : `FAILED: ${email} — ${result.error}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
