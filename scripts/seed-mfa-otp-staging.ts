/**
 * Dev-only: seed a known SMS OTP for live MFA browser testing (staging).
 * Usage: npx tsx scripts/seed-mfa-otp-staging.ts
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";

loadEnvForce(resolve(process.cwd(), ".env.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url.includes("wieflwbfdmjtsdnwbfii")) {
  throw new Error("Refusing: not staging Supabase URL");
}

const admin = createClient(url, key, { auth: { persistSession: false } });
const authUid = "ad8f7ef2-e017-4c4f-909f-58fa482921fd";
const otp = "654321";
const pepper = process.env.MFA_OTP_PEPPER?.trim() || key;
const now = new Date().toISOString();
const expires = new Date(Date.now() + 5 * 60_000).toISOString();

async function main() {
  await admin
    .from("login_sms_otp_challenges")
    .update({ consumed_at: now })
    .eq("auth_uid", authUid)
    .eq("purpose", "login")
    .is("consumed_at", null);

  const { data: row, error } = await admin
    .from("login_sms_otp_challenges")
    .insert({
      auth_uid: authUid,
      purpose: "login",
      phone_e164: "+233541400004",
      otp_hash: "pending",
      expires_at: expires,
      request_ip: "127.0.0.1",
    })
    .select("id")
    .single();

  if (error || !row) {
    throw error ?? new Error("insert failed");
  }

  const hash = createHash("sha256")
    .update(`${otp}:${row.id}:${pepper}`)
    .digest("hex");

  await admin
    .from("login_sms_otp_challenges")
    .update({ otp_hash: hash })
    .eq("id", row.id);

  console.log(`Seeded OTP ${otp} for ${authUid} (challenge ${row.id})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
