import "server-only";

import { createHash, randomInt } from "node:crypto";
import { createAdminClient } from "@/utils/supabase/admin";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import type { SmsOtpPurpose } from "./types";

const OTP_TTL_MINUTES = 5;

function getOtpPepper(): string {
  const pepper =
    process.env.MFA_OTP_PEPPER?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!pepper) {
    throw new Error("MFA_OTP_PEPPER (or service role key) is not configured.");
  }
  return pepper;
}

export function generateSmsOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

export function hashSmsOtp(otp: string, challengeId: string): string {
  return createHash("sha256")
    .update(`${otp}:${challengeId}:${getOtpPepper()}`)
    .digest("hex");
}

export async function invalidateActiveSmsOtpChallenges(
  authUid: string,
  purpose: SmsOtpPurpose,
): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin
    .from("login_sms_otp_challenges")
    .update({ consumed_at: now })
    .eq("auth_uid", authUid)
    .eq("purpose", purpose)
    .is("consumed_at", null);
}

export async function createAndSendSmsOtpChallenge(options: {
  authUid: string;
  phoneE164: string;
  purpose: SmsOtpPurpose;
  requestIp: string;
}): Promise<
  | { ok: true; challengeId: string }
  | { ok: false; error: string }
> {
  const admin = createAdminClient();
  await invalidateActiveSmsOtpChallenges(options.authUid, options.purpose);

  const otp = generateSmsOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();

  const { data: row, error: insertError } = await admin
    .from("login_sms_otp_challenges")
    .insert({
      auth_uid: options.authUid,
      purpose: options.purpose,
      phone_e164: options.phoneE164,
      otp_hash: "pending",
      expires_at: expiresAt,
      request_ip: options.requestIp,
    })
    .select("id")
    .single();

  if (insertError || !row) {
    return {
      ok: false,
      error: insertError?.message ?? "Could not create SMS challenge.",
    };
  }

  const otpHash = hashSmsOtp(otp, row.id);
  await admin
    .from("login_sms_otp_challenges")
    .update({ otp_hash: otpHash })
    .eq("id", row.id);

  const label =
    options.purpose === "enrollment" ? "verification" : "login";
  const smsResult = await sendHubtelSms({
    to: options.phoneE164,
    content: `Your Davors ${label} code is ${otp}. It expires in ${OTP_TTL_MINUTES} minutes.`,
  });

  if (!smsResult.ok) {
    await admin
      .from("login_sms_otp_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", row.id);
    return { ok: false, error: smsResult.error };
  }

  await admin
    .from("login_sms_otp_challenges")
    .update({ hubtel_message_id: smsResult.id })
    .eq("id", row.id);

  return { ok: true, challengeId: row.id };
}

export async function verifySmsOtpChallenge(options: {
  authUid: string;
  purpose: SmsOtpPurpose;
  code: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const trimmed = options.code.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return { ok: false, error: "Enter the 6-digit code from your SMS." };
  }

  const now = new Date().toISOString();
  const { data: challenge, error } = await admin
    .from("login_sms_otp_challenges")
    .select("*")
    .eq("auth_uid", options.authUid)
    .eq("purpose", options.purpose)
    .is("consumed_at", null)
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !challenge) {
    return { ok: false, error: "No active SMS code. Request a new one." };
  }

  if (challenge.attempt_count >= challenge.max_attempts) {
    return {
      ok: false,
      error: "Too many incorrect codes. Request a new SMS code.",
    };
  }

  const expectedHash = hashSmsOtp(trimmed, challenge.id);
  const matches = expectedHash === challenge.otp_hash;

  if (!matches) {
    await admin
      .from("login_sms_otp_challenges")
      .update({ attempt_count: challenge.attempt_count + 1 })
      .eq("id", challenge.id);
    return { ok: false, error: "Incorrect code. Try again." };
  }

  await admin
    .from("login_sms_otp_challenges")
    .update({ consumed_at: now })
    .eq("id", challenge.id);

  return { ok: true };
}
