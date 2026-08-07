import "server-only";

import { cookies, headers } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getRequestIp } from "@/utils/login-rate-limit";
import { getUserMfaSettings } from "./aal-gate";
import {
  assertMfaResendAllowed,
  assertMfaVerifyAllowed,
  recordFailedMfaVerifyAttempt,
  recordMfaResend,
} from "./mfa-rate-limit";
import { revokeLoginMfaSessions } from "./mfa-session";
import { toGhanaE164 } from "./phone-utils";
import { persistUserMfaSettings } from "./persist-settings";
import { resolveSmsPhoneForPersona } from "./sms-phone";
import {
  createAndSendSmsOtpChallenge,
  verifySmsOtpChallenge,
} from "./sms-otp";
import {
  clearStaleTotpEnrollmentFactors,
  getVerifiedTotpFactorId,
  TOTP_ENROLLMENT_FRIENDLY_NAME,
  verifyTotpLoginCode,
} from "./totp";
import type { MfaActionResult, MfaPersona } from "./types";

async function resolveSmsEnrollmentPhoneE164(
  authUid: string,
  persona: MfaPersona,
  phoneOverride?: string,
): Promise<{ ok: true; phoneE164: string } | { ok: false; error: string }> {
  const resolved = await resolveSmsPhoneForPersona(authUid, persona);

  if (persona === "staff") {
    if (resolved.phoneE164 && resolved.source === "employees.phone") {
      return { ok: true, phoneE164: resolved.phoneE164 };
    }

    const trimmed = phoneOverride?.trim();
    if (!trimmed) {
      return {
        ok: false,
        error: "Enter a mobile number to receive the verification code.",
      };
    }

    const phoneE164 = toGhanaE164(trimmed);
    if (!phoneE164) {
      return {
        ok: false,
        error: "Enter a valid Ghana mobile number (e.g. 024XXXXXXX).",
      };
    }

    return { ok: true, phoneE164 };
  }

  if (phoneOverride?.trim()) {
    const phoneE164 = toGhanaE164(phoneOverride);
    if (phoneE164) {
      return { ok: true, phoneE164 };
    }
  }

  if (resolved.phoneE164) {
    return { ok: true, phoneE164: resolved.phoneE164 };
  }

  return {
    ok: false,
    error:
      "No phone number on your profile. Add a phone to your portal profile first.",
  };
}

async function getAuthedSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export async function getMfaSettingsForCurrentUser(persona: MfaPersona) {
  const supabase = await getAuthedSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const settings = await getUserMfaSettings(user.id, supabase);
  const { phoneE164, source } = await resolveSmsPhoneForPersona(
    user.id,
    persona,
  );

  const staffSmsEnrollmentPhoneLocked =
    persona === "staff" && Boolean(phoneE164 && source === "employees.phone");

  return {
    method: settings?.method ?? "none",
    smsPhoneE164: settings?.sms_phone_e164 ?? null,
    totpEnrolledAt: settings?.totp_enrolled_at ?? null,
    profilePhoneE164: phoneE164,
    profilePhoneSource: source,
    staffSmsEnrollmentPhoneLocked,
    email: user.email ?? "",
  };
}

export async function startTotpEnrollment(): Promise<
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; error: string }
> {
  const supabase = await getAuthedSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const existing = await getUserMfaSettings(user.id, supabase);
  if (existing?.method === "sms") {
    return {
      ok: false,
      error: "Disable SMS two-factor before enrolling an authenticator app.",
    };
  }

  await clearStaleTotpEnrollmentFactors(supabase);

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: TOTP_ENROLLMENT_FRIENDLY_NAME,
  });

  if (error || !data || data.type !== "totp") {
    const message = error?.message ?? "Could not start TOTP enrollment.";
    if (
      message.includes("friendly name") &&
      message.includes("already exists")
    ) {
      return {
        ok: false,
        error:
          "A previous authenticator setup was not finished. Click “Set up authenticator app” again to start over.",
      };
    }
    return { ok: false, error: message };
  }

  return {
    ok: true,
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

export async function confirmTotpEnrollment(
  factorId: string,
  code: string,
): Promise<MfaActionResult> {
  const supabase = await getAuthedSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const trimmed = code.trim();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: trimmed,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const now = new Date().toISOString();
  const persisted = await persistUserMfaSettings({
    authUid: user.id,
    method: "totp",
    smsPhoneE164: null,
    smsPhoneVerifiedAt: null,
    totpEnrolledAt: now,
  });

  if (!persisted.ok) {
    return persisted;
  }

  await revokeLoginMfaSessions(user.id);
  return { ok: true };
}

export async function sendSmsEnrollmentOtp(
  persona: MfaPersona,
  phoneOverride?: string,
): Promise<MfaActionResult> {
  const supabase = await getAuthedSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const existing = await getUserMfaSettings(user.id, supabase);
  if (existing?.method === "totp") {
    return {
      ok: false,
      error: "Disable authenticator app two-factor before enrolling SMS.",
    };
  }

  const verifiedTotp = await getVerifiedTotpFactorId(supabase);
  if (verifiedTotp) {
    return {
      ok: false,
      error: "Remove your authenticator app enrollment before enabling SMS.",
    };
  }

  let phoneE164: string | null = null;
  const phoneResult = await resolveSmsEnrollmentPhoneE164(
    user.id,
    persona,
    phoneOverride,
  );
  if (!phoneResult.ok) {
    return phoneResult;
  }
  phoneE164 = phoneResult.phoneE164;

  if (!phoneE164) {
    return {
      ok: false,
      error: "Phone number is required.",
    };
  }

  const headerStore = await headers();
  const ip = getRequestIp(headerStore);

  const allowed = await assertMfaResendAllowed(phoneE164, ip);
  if (!allowed.ok) return allowed;

  const sent = await createAndSendSmsOtpChallenge({
    authUid: user.id,
    phoneE164,
    purpose: "enrollment",
    requestIp: ip,
  });

  if (!sent.ok) return sent;

  await recordMfaResend(phoneE164, ip);
  return { ok: true };
}

export async function confirmSmsEnrollment(
  persona: MfaPersona,
  code: string,
  phoneOverride?: string,
): Promise<MfaActionResult> {
  const supabase = await getAuthedSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const headerStore = await headers();
  const ip = getRequestIp(headerStore);
  const email = user.email ?? "";

  const allowed = await assertMfaVerifyAllowed(email, ip);
  if (!allowed.ok) return allowed;

  const verified = await verifySmsOtpChallenge({
    authUid: user.id,
    purpose: "enrollment",
    code,
  });

  if (!verified.ok) {
    await recordFailedMfaVerifyAttempt(email, ip);
    return verified;
  }

  let phoneE164: string | null = null;
  const phoneResult = await resolveSmsEnrollmentPhoneE164(
    user.id,
    persona,
    phoneOverride,
  );
  if (!phoneResult.ok) {
    return phoneResult;
  }
  phoneE164 = phoneResult.phoneE164;

  if (!phoneE164) {
    return { ok: false, error: "Phone number is required." };
  }

  const now = new Date().toISOString();
  const persisted = await persistUserMfaSettings({
    authUid: user.id,
    method: "sms",
    smsPhoneE164: phoneE164,
    smsPhoneVerifiedAt: now,
    totpEnrolledAt: null,
  });

  if (!persisted.ok) {
    return persisted;
  }

  await revokeLoginMfaSessions(user.id);
  return { ok: true };
}

export async function disableMfa(
  persona: MfaPersona,
  code: string,
): Promise<MfaActionResult> {
  void persona;
  const supabase = await getAuthedSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const settings = await getUserMfaSettings(user.id, supabase);
  if (!settings || settings.method === "none") {
    return { ok: true };
  }

  const headerStore = await headers();
  const ip = getRequestIp(headerStore);
  const email = user.email ?? "";

  const allowed = await assertMfaVerifyAllowed(email, ip);
  if (!allowed.ok) return allowed;

  if (settings.method === "totp") {
    const result = await verifyTotpLoginCode(supabase, code);
    if (!result.ok) {
      await recordFailedMfaVerifyAttempt(email, ip);
      return result;
    }

    const factorId = await getVerifiedTotpFactorId(supabase);
    if (factorId) {
      await supabase.auth.mfa.unenroll({ factorId });
    }
  } else if (settings.method === "sms") {
    const verified = await verifySmsOtpChallenge({
      authUid: user.id,
      purpose: "login",
      code,
    });
    if (!verified.ok) {
      await recordFailedMfaVerifyAttempt(email, ip);
      return verified;
    }
  }

  const admin = createAdminClient();
  await admin.from("user_mfa_settings").upsert(
    {
      auth_uid: user.id,
      method: "none",
      sms_phone_e164: null,
      sms_phone_verified_at: null,
      totp_enrolled_at: null,
    },
    { onConflict: "auth_uid" },
  );

  await revokeLoginMfaSessions(user.id);
  return { ok: true };
}
