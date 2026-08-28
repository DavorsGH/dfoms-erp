/**
 * Set a known password on the staging FM test account for browser verification.
 * Usage: npx tsx scripts/_set-fm-test-password-staging.ts
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const FM_EMAIL = "david.avors+fm@gmail.com";
const FM_PASSWORD = "FmStagingTest!2026";
const AUTH_USER_ID = "322f1c8e-1cb1-46b6-8498-ceeef75fbdbd";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) throw new Error("Missing staging Supabase creds");
  if (!new URL(url).hostname.includes("wieflwbfdmjtsdnwbfii")) {
    throw new Error("Refusing: not staging");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.updateUserById(AUTH_USER_ID, {
    password: FM_PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  console.log("OK: password set for", data.user?.email ?? FM_EMAIL);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
