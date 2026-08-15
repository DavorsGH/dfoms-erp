/**
 * Staging: security nudge delete cooldown (MFA + password, 30 days).
 *
 * Usage: npx tsx scripts/test-mfa-nudge-dismissal-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const MFA_NUDGE_TITLE = "Activate two-factor authentication";
const PASSWORD_NUDGE_TITLE = "Update your password";
const NUDGE_TYPES = ["mfa_enrollment", "password_update"] as const;
const COOLDOWN_DAYS = 30;

function loadEnv() {
  for (const line of readFileSync(resolve(".env.local"), "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] ??= value;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function cooldownCutoffIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function isInCooldown(admin, authUid, nudgeType) {
  const { data } = await admin
    .from("security_notification_dismissals")
    .select("dismissed_at")
    .eq("auth_uid", authUid)
    .eq("nudge_type", nudgeType)
    .maybeSingle();

  if (!data?.dismissed_at) {
    return false;
  }
  return data.dismissed_at >= cooldownCutoffIso(COOLDOWN_DAYS);
}

async function recordDismissal(admin, authUid, nudgeType) {
  const now = new Date().toISOString();
  const { error } = await admin.from("security_notification_dismissals").upsert(
    {
      auth_uid: authUid,
      nudge_type: nudgeType,
      dismissed_at: now,
      updated_at: now,
    },
    { onConflict: "auth_uid,nudge_type" },
  );
  assert(!error, error?.message ?? "upsert failed");
}

async function runCooldownCycle(admin, authUid, nudgeType, label) {
  await admin
    .from("security_notification_dismissals")
    .delete()
    .eq("auth_uid", authUid)
    .eq("nudge_type", nudgeType);

  assert(!(await isInCooldown(admin, authUid, nudgeType)), `${label}: no cooldown initially`);
  console.log(`PASS ${label}: no cooldown initially`);

  await recordDismissal(admin, authUid, nudgeType);
  assert(await isInCooldown(admin, authUid, nudgeType), `${label}: cooldown after dismissal`);
  console.log(`PASS ${label}: cooldown active after dismissal`);

  const stale = cooldownCutoffIso(31);
  await admin
    .from("security_notification_dismissals")
    .update({ dismissed_at: stale, updated_at: stale })
    .eq("auth_uid", authUid)
    .eq("nudge_type", nudgeType);

  assert(!(await isInCooldown(admin, authUid, nudgeType)), `${label}: expired after 31d`);
  console.log(`PASS ${label}: cooldown expired after 31 days`);

  await admin
    .from("security_notification_dismissals")
    .delete()
    .eq("auth_uid", authUid)
    .eq("nudge_type", nudgeType);
}

async function main() {
  loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url && key, "Missing staging Supabase env");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: tableError } = await admin
    .from("security_notification_dismissals")
    .select("auth_uid")
    .limit(1);
  assert(!tableError, `Table missing? ${tableError?.message}`);

  const { data: testAccount } = await admin
    .from("user_accounts")
    .select("auth_uid, tenant_id")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  assert(testAccount?.auth_uid, "Need a test auth uid on staging");
  const testUid = testAccount.auth_uid;
  console.log("Test auth_uid:", testUid);

  for (const nudgeType of NUDGE_TYPES) {
    await runCooldownCycle(admin, testUid, nudgeType, nudgeType);
  }

  const tenantId = testAccount.tenant_id;
  if (tenantId) {
    await recordDismissal(admin, testUid, "password_update");
    assert(
      await isInCooldown(admin, testUid, "password_update"),
      "password_update should block recreate while in cooldown",
    );
    console.log("PASS password_update suppresses recreate during cooldown");

    await admin
      .from("security_notification_dismissals")
      .delete()
      .eq("auth_uid", testUid)
      .eq("nudge_type", "password_update");
  }

  console.log("All security nudge dismissal staging checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
