/**
 * Verify MFA SMS login bypass logic against production settings.
 * Usage: MFA_SMS_LOGIN_BYPASS=true npx tsx scripts/_verify-mfa-sms-bypass-production.ts --env-file .env.local.backup
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const SMS_USER = "c199cb86-2d8b-4b1f-815d-1f76100c0ad6";

async function main() {
  loadEnvFromArgv(process.argv);
  const bypass = process.env.MFA_SMS_LOGIN_BYPASS === "true";
  const enforcement = process.env.MFA_ENFORCEMENT === "true";
  console.log({ MFA_ENFORCEMENT: enforcement, MFA_SMS_LOGIN_BYPASS: bypass });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(PRODUCTION_REF), "Refusing non-production");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: settings } = await admin
    .from("user_mfa_settings")
    .select("auth_uid, method")
    .eq("auth_uid", SMS_USER)
    .maybeSingle();

  console.log("SMS user settings:", settings);

  // Simulate post-login gate
  const method = settings?.method ?? "none";
  let postLogin: { mfaRequired: boolean; method?: string } = { mfaRequired: false };
  if (enforcement && method !== "none") {
    if (method === "totp") {
      postLogin = { mfaRequired: true, method: "totp" };
    } else if (method === "sms") {
      postLogin = bypass
        ? { mfaRequired: false }
        : { mfaRequired: true, method: "sms" };
    }
  }
  console.log("Simulated post-login:", postLogin);

  // Simulate middleware gate (no session key = would be pending without bypass)
  let gateStatus = "not_required";
  if (enforcement && method !== "none") {
    if (method === "totp") gateStatus = "pending";
    else if (method === "sms") gateStatus = bypass ? "not_required" : "pending";
  }
  console.log("Simulated middleware gate:", gateStatus);

  if (!bypass) {
    console.warn("Set MFA_SMS_LOGIN_BYPASS=true to unlock SMS MFA users.");
    process.exit(1);
  }
  if (postLogin.mfaRequired || gateStatus === "pending") {
    console.error("FAIL — user would still be locked out.");
    process.exit(1);
  }
  console.log("PASS — SMS MFA user can log in with password only.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
