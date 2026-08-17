/**
 * Staging repair: recreate missing Supabase Auth users for orphaned user_accounts rows.
 * Preserves existing user_accounts.auth_uid (createUser with explicit id).
 * Does NOT send email. Verifies updateUserById (reset password path) after repair.
 *
 *   npx tsx scripts/repair-orphaned-user-accounts-auth-staging.ts --env-file .env.staging.local
 *   npx tsx scripts/repair-orphaned-user-accounts-auth-staging.ts --env-file .env.staging.local --dry-run
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { auditOrphanedUserAccounts } from "./audit-orphaned-user-accounts-auth";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const REPAIR_PASSWORD_PREFIX = "OrphanRepair-";

function repairPassword(): string {
  return `${REPAIR_PASSWORD_PREFIX}${randomBytes(12).toString("base64url")}!9`;
}

async function main() {
  const argv = process.argv.slice(2);
  loadEnvFromArgv(argv);
  const dryRun = argv.includes("--dry-run");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes(STAGING_REF), `Refusing: expected staging ref ${STAGING_REF}`);

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const orphans = await auditOrphanedUserAccounts(admin);
  console.log(`Found ${orphans.length} orphaned user_accounts row(s).`);
  if (orphans.length === 0) {
    console.log("Nothing to repair.");
    return;
  }

  const repaired: string[] = [];
  const skipped: Array<{ email: string; reason: string }> = [];
  const failed: Array<{ email: string; reason: string }> = [];

  for (const row of orphans) {
    const label = `${row.display_name} <${row.email}>`;
    console.log(`\n--- ${label} ---`);
    console.log("auth_uid:", row.auth_uid);
    console.log("tenant_id:", row.tenant_id);

    if (!row.email) {
      skipped.push({ email: row.auth_uid, reason: "missing email on user_accounts row" });
      console.log("SKIP: missing email");
      continue;
    }

    if (row.email_mismatch && row.email_auth_uid) {
      skipped.push({
        email: row.email,
        reason: `email already linked to different auth user ${row.email_auth_uid}`,
      });
      console.log(
        "SKIP: email exists on different auth user:",
        row.email_auth_uid,
      );
      continue;
    }

    if (dryRun) {
      console.log("DRY RUN: would createUser with id=", row.auth_uid);
      repaired.push(row.email);
      continue;
    }

    const tempPassword = repairPassword();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      id: row.auth_uid,
      email: row.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { portal: "staff" },
    });

    if (createError || !created.user) {
      failed.push({
        email: row.email,
        reason: createError?.message ?? "createUser returned no user",
      });
      console.log("FAILED createUser:", createError?.message ?? "no user");
      continue;
    }

    if (created.user.id !== row.auth_uid) {
      failed.push({
        email: row.email,
        reason: `createUser id mismatch: got ${created.user.id}, expected ${row.auth_uid}`,
      });
      console.log("FAILED: auth id mismatch");
      await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
      continue;
    }

    const { data: verifyData, error: verifyError } =
      await admin.auth.admin.getUserById(row.auth_uid);
    if (verifyError || !verifyData?.user) {
      failed.push({
        email: row.email,
        reason: verifyError?.message ?? "getUserById failed after create",
      });
      console.log("FAILED verify getUserById:", verifyError?.message);
      continue;
    }

    const resetPassword = `${REPAIR_PASSWORD_PREFIX}${randomBytes(10).toString("hex")}!9Aa`;
    const { error: updateError } = await admin.auth.admin.updateUserById(
      row.auth_uid,
      { password: resetPassword },
    );
    if (updateError) {
      failed.push({
        email: row.email,
        reason: `updateUserById (reset password) failed: ${updateError.message}`,
      });
      console.log("FAILED reset password simulation:", updateError.message);
      continue;
    }

    console.log("REPAIRED: auth user recreated, getUserById OK, reset password OK");
    repaired.push(row.email);
  }

  console.log("\n=== Repair summary ===");
  console.log("Repaired:", repaired.length ? repaired.join(", ") : "(none)");
  if (skipped.length) {
    console.log("Skipped:");
    for (const s of skipped) {
      console.log(`  - ${s.email}: ${s.reason}`);
    }
  }
  if (failed.length) {
    console.log("Failed:");
    for (const f of failed) {
      console.log(`  - ${f.email}: ${f.reason}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
