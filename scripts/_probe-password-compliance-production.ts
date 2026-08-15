/**
 * Probe password compliance state for a user on production.
 * Usage: npx tsx scripts/_probe-password-compliance-production.ts --env-file .env.local.backup [email]
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import {
  getPasswordPolicyRolloutDate,
  PASSWORD_MIN_LENGTH,
} from "../utils/password-policy";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DEFAULT_EMAIL = "david.avors@gmail.com";

async function main() {
  loadEnvFromArgv(process.argv);
  const emailArg = process.argv.find((a) => a.includes("@"));
  const email = emailArg ?? DEFAULT_EMAIL;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(PRODUCTION_REF), "Refusing non-production");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = users?.users?.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!user) {
    console.error("Auth user not found for", email);
    process.exit(1);
  }

  console.log("auth_uid:", user.id);
  console.log("email:", user.email);
  console.log("auth created_at:", user.created_at);
  console.log("last_sign_in_at:", user.last_sign_in_at);

  const rollout = getPasswordPolicyRolloutDate();
  console.log("\nPASSWORD_POLICY_ROLLOUT_AT env:", process.env.PASSWORD_POLICY_ROLLOUT_AT ?? "(default 2026-08-07)");
  console.log("Rollout cutoff:", rollout.toISOString());

  const { data: sec, error: secErr } = await admin
    .from("user_auth_security")
    .select("auth_uid, password_updated_at, updated_at")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (secErr) {
    console.error("\nuser_auth_security query error:", secErr.message);
    console.error("(Table may be missing on production if migration 179 not applied)");
  } else {
    console.log("\nuser_auth_security row:", sec ?? "(none)");
    if (sec?.password_updated_at) {
      const updatedMs = new Date(sec.password_updated_at).getTime();
      const compliant = updatedMs >= rollout.getTime();
      console.log("Compliant per isPasswordUpdatedAtCompliant:", compliant);
    } else {
      console.log("Compliant: false (no row or null password_updated_at)");
    }
  }

  const { data: accounts } = await admin
    .from("user_accounts")
    .select("tenant_id, role, email, is_active")
    .eq("auth_uid", user.id);

  console.log("\nuser_accounts:", accounts);

  const { data: nudges } = await admin
    .from("employee_notifications")
    .select("id, tenant_id, title, read_at, created_at")
    .eq("recipient_user_id", user.id)
    .eq("title", "Update your password")
    .order("created_at", { ascending: false })
    .limit(5);

  console.log("\nRecent password nudges (staff inbox):", nudges ?? []);

  const { data: unreadPw } = await admin
    .from("employee_notifications")
    .select("id, title, read_at, created_at")
    .eq("recipient_user_id", user.id)
    .eq("title", "Update your password")
    .is("read_at", null);

  console.log("Unread password nudges:", unreadPw ?? []);

  const { data: unreadAll } = await admin
    .from("employee_notifications")
    .select("id, title, read_at, created_at")
    .eq("recipient_user_id", user.id)
    .is("read_at", null);

  console.log("All unread staff notifications:", unreadAll ?? []);
  console.log("\nPolicy min length:", PASSWORD_MIN_LENGTH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
