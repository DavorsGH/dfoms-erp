/**
 * Debug MFA login gate for a specific email on staging.
 * Usage: npx tsx scripts/debug-mfa-login-gate-staging.ts info@caanta.com
 */
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { loadEnvForce } from "./lib/env";

const email = process.argv[2] ?? "info@caanta.com";

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  loadEnvForce(resolve(process.cwd(), ".env.local"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const mfaEnforcement = process.env.MFA_ENFORCEMENT ?? "(unset)";

  console.log("NEXT_PUBLIC_SUPABASE_URL ref:", url.split(".")[0]?.slice(-20));
  console.log("MFA_ENFORCEMENT raw:", JSON.stringify(mfaEnforcement));
  console.log("MFA_ENFORCEMENT === 'true':", mfaEnforcement === "true");
  console.log("SUPABASE_SERVICE_ROLE_KEY present:", Boolean(serviceKey));

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: users, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw listError;

  const user = users.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!user) {
    console.error("No auth user for", email);
    process.exit(1);
  }

  console.log("\nAuth user:", user.id, user.email);

  const { data: settings, error: settingsError } = await admin
    .from("user_mfa_settings")
    .select("*")
    .eq("auth_uid", user.id)
    .maybeSingle();

  console.log("\nuser_mfa_settings row:");
  if (settingsError) {
    console.log("  ERROR:", settingsError.message);
  } else if (!settings) {
    console.log("  (no row)");
  } else {
    console.log(JSON.stringify(settings, null, 2));
  }

  const { data: account } = await admin
    .from("user_accounts")
    .select("auth_uid, employee_id, is_active, role")
    .eq("auth_uid", user.id)
    .maybeSingle();
  console.log("\nuser_accounts:", account);

  const { data: lessee } = await admin
    .from("lessees")
    .select("lessee_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const { data: landlord } = await admin
    .from("landlords")
    .select("tenant_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  console.log("lessee:", lessee, "landlord:", landlord);

  const { data: mfaSessions } = await admin
    .from("login_mfa_sessions")
    .select("*")
    .eq("auth_uid", user.id);
  console.log("\nlogin_mfa_sessions:", mfaSessions?.length ?? 0, "rows");
  if (mfaSessions?.length) console.log(mfaSessions);

  // Simulate evaluatePostPasswordMfa
  const enforcementOn = process.env.MFA_ENFORCEMENT === "true";
  let mfaResult: unknown = { mfaRequired: false };
  if (enforcementOn && settings?.method === "sms") {
    mfaResult = {
      mfaRequired: true,
      method: "sms",
      sms_phone_e164: settings.sms_phone_e164,
    };
  } else if (enforcementOn && settings?.method === "totp") {
    mfaResult = { mfaRequired: true, method: "totp" };
  } else if (!enforcementOn) {
    mfaResult = { mfaRequired: false, reason: "MFA_ENFORCEMENT not true" };
  } else {
    mfaResult = {
      mfaRequired: false,
      reason: "method not sms/totp",
      method: settings?.method ?? "none",
    };
  }
  console.log("\nSimulated evaluatePostPasswordMfa:", mfaResult);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
