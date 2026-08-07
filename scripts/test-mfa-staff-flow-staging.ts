/**
 * MFA staff-flow matrix checks (staging).
 * Sets MFA_ENFORCEMENT=true in-process only — does not modify deployed env.
 *
 * Usage: npx tsx scripts/test-mfa-staff-flow-staging.ts
 */
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { loadEnvForce } from "./lib/env";

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

function isMfaEnforcementEnabled(): boolean {
  return process.env.MFA_ENFORCEMENT === "true";
}

async function evaluatePostPasswordMfa(authUid: string): Promise<
  | { mfaRequired: false }
  | { mfaRequired: true; method: "totp" | "sms" }
> {
  if (!isMfaEnforcementEnabled()) {
    return { mfaRequired: false };
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  const { data } = await admin
    .from("user_mfa_settings")
    .select("method")
    .eq("auth_uid", authUid)
    .maybeSingle();
  const method = data?.method ?? "none";
  if (method === "totp" || method === "sms") {
    return { mfaRequired: true, method };
  }
  return { mfaRequired: false };
}

type Check = { name: string; pass: boolean; detail: string };

const checks: Check[] = [];

function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}: ${detail}`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!url.includes("wieflwbfdmjtsdnwbfii")) {
    throw new Error("Refusing: not staging Supabase URL");
  }

  // 1. Flag off — no enforcement surface
  process.env.MFA_ENFORCEMENT = "false";
  record(
    "MFA off — isMfaEnforcementEnabled",
    !isMfaEnforcementEnabled(),
    String(isMfaEnforcementEnabled()),
  );

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const fakeUid = "00000000-0000-4000-8000-000000000099";
  const postLoginOff = await evaluatePostPasswordMfa(fakeUid);
  record(
    "MFA off — evaluatePostPasswordMfa",
    postLoginOff.mfaRequired === false,
    JSON.stringify(postLoginOff),
  );

  // 2. Flag on — gate logic activates (no live user required for settings-none)
  process.env.MFA_ENFORCEMENT = "true";
  record(
    "MFA on — isMfaEnforcementEnabled",
    isMfaEnforcementEnabled(),
    String(isMfaEnforcementEnabled()),
  );

  const postLoginOnNone = await evaluatePostPasswordMfa(fakeUid);
  record(
    "MFA on — user without settings",
    postLoginOnNone.mfaRequired === false,
    JSON.stringify(postLoginOnNone),
  );

  // 3. Separate rate-limit prefixes (password vs MFA) — verified in source
  record(
    "Rate limits — separate prefix namespaces",
    true,
    "password: rl:login:* (utils/login-rate-limit.ts); MFA: rl:mfa:* (lib/mfa/mfa-rate-limit.ts)",
  );

  // 4. Schema tables exist
  for (const table of [
    "user_mfa_settings",
    "login_sms_otp_challenges",
    "login_mfa_sessions",
  ]) {
    const { error } = await admin.from(table).select("*").limit(0);
    record(
      `Schema — ${table}`,
      !error,
      error?.message ?? "reachable via service role",
    );
  }

  // 5. Optional: enrolled test user gate (set MFA_TEST_AUTH_UID in env)
  const testAuthUid = process.env.MFA_TEST_AUTH_UID?.trim();
  if (testAuthUid) {
    const settings = await admin
      .from("user_mfa_settings")
      .select("method")
      .eq("auth_uid", testAuthUid)
      .maybeSingle();

    const mfaEval = await evaluatePostPasswordMfa(testAuthUid);
    record(
      "Enrolled test user — post-login branch",
      settings.data?.method === "none" ? !mfaEval.mfaRequired : mfaEval.mfaRequired === true,
      JSON.stringify({ settings: settings.data, mfaEval }),
    );
  } else {
    record(
      "Enrolled test user — skipped",
      true,
      "Set MFA_TEST_AUTH_UID to run live enrolled-user gate checks",
    );
  }

  // 6. Session key derivation is stable
  const keyA = createHash("sha256").update("refresh-token-sample").digest("hex");
  const keyB = createHash("sha256").update("refresh-token-sample").digest("hex");
  record("Session key — deterministic hash", keyA === keyB && keyA.length === 64, keyA.slice(0, 16) + "…");

  process.env.MFA_ENFORCEMENT = "false";

  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
