/**
 * Verify login MFA branch reads .env.local the same way `next dev` does.
 * Usage: npx tsx scripts/test-mfa-login-path-staging.ts
 */
import { resolve } from "node:path";
import { loadEnvForce } from "./lib/env";

const CAANTA_AUTH_UID = "ad8f7ef2-e017-4c4f-909f-58fa482921fd";

async function main() {
  // Mirror Next.js dev: .env.local only (not .env.staging.local)
  loadEnvForce(resolve(process.cwd(), ".env.local"));

  const { isMfaEnforcementEnabled, getMfaEnforcementEnvDebug } = await import(
    "../lib/mfa/config"
  );
  const { evaluatePostPasswordMfa } = await import("../lib/mfa/post-login");

  const envDebug = getMfaEnforcementEnvDebug();
  console.log("Env (.env.local only):", envDebug);

  const mfa = await evaluatePostPasswordMfa(CAANTA_AUTH_UID);
  console.log("evaluatePostPasswordMfa:", mfa);

  if (!envDebug.enabled) {
    throw new Error("MFA_ENFORCEMENT is not true in .env.local — next dev will skip MFA.");
  }
  if (!mfa.mfaRequired || mfa.method !== "sms") {
    throw new Error(`Expected mfaRequired sms, got ${JSON.stringify(mfa)}`);
  }

  console.log("\nPASS — login action would return mfaRequired; restart `npm run dev` and log in to hit /login/mfa");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
