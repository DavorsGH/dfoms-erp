/**
 * Verify Supabase Auth password settings on staging by probing weak_password responses.
 * Also prints manual dashboard steps if Management API token is unavailable.
 *
 * Usage: npx tsx scripts/verify-password-auth-settings-staging.ts
 */
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";
import { mapSupabasePasswordError, PASSWORD_MIN_LENGTH } from "../utils/password-policy";

loadEnvForce(resolve(process.cwd(), ".env.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url.includes("wieflwbfdmjtsdnwbfii")) {
  throw new Error("Refusing: not staging Supabase URL");
}

function logResult(label: string, error: unknown) {
  const mapped = mapSupabasePasswordError(error);
  const raw =
    error && typeof error === "object"
      ? {
          code: (error as { code?: string }).code,
          message: (error as { message?: string }).message,
          reasons: (error as { reasons?: string[] }).reasons,
        }
      : error;
  console.log(`\n${label}`);
  console.log("  raw:", JSON.stringify(raw));
  console.log("  mapped:", mapped);
}

async function probeSignup(email: string, password: string, label: string) {
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await client.auth.signUp({ email, password });
  logResult(label, error ?? { message: "(no error — unexpected success)" });

  if (!error) {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const created = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (created) {
      await admin.auth.admin.deleteUser(created.id);
      console.log("  cleaned up probe user", created.id);
    }
  }
}

async function main() {
  console.log("=== Supabase Auth password settings verification (staging) ===\n");
  console.log(
    "Manual dashboard (Auth → Providers → Email → Password settings):",
  );
  console.log(`  • Minimum password length: ${PASSWORD_MIN_LENGTH}`);
  console.log("  • Required characters: none (length + leaked check only)");
  console.log('  • Prevent use of leaked passwords: ON (Pro plan feature)');
  console.log("  • Do not change other Attack Protection settings\n");

  const stamp = Date.now();
  await probeSignup(
    `pwd-probe-short.${stamp}@test.davors`,
    "short1",
    `Too short (${"short1".length} chars, expect weak_password / length)`,
  );

  // Commonly breached password (HaveIBeenPwned list) — expect pwned when HIBP enabled.
  await probeSignup(
    `pwd-probe-pwned.${stamp}@test.davors`,
    "password123456",
    "Known weak password (expect weak_password / pwned if HIBP enabled)",
  );

  console.log("\nDone. If length/pwned probes did not return weak_password, update Auth settings in the dashboard.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
