import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { completePlatformSignOut } from "@/lib/auth/sign-out";
import { createClient } from "@/utils/supabase/server";
import { getRequestIp } from "@/utils/login-rate-limit";
import {
  assertMfaResendAllowed,
  assertMfaVerifyAllowed,
  MFA_VERIFY_RATE_LIMIT_MESSAGE,
  recordFailedMfaVerifyAttempt,
  recordMfaResend,
} from "./mfa-rate-limit";
import {
  logAuthActivity,
  resolveAuthActivityTenantId,
} from "@/lib/user-activity-log";
import {
  createLoginMfaSession,
  deleteLoginMfaSessionForKey,
  deriveSessionKeyFromAuthSession,
  revokeLoginMfaSessions,
} from "./mfa-session";
import { resolveEnrolledSmsPhone } from "./sms-phone";
import {
  createAndSendSmsOtpChallenge,
  verifySmsOtpChallenge,
} from "./sms-otp";
import { verifyTotpLoginCode } from "./totp";
import type { MfaActionResult, MfaPersona } from "./types";

async function getAuthedSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

async function requireAuthedUser(supabase: SupabaseClient) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false as const, error: "You must be signed in." };
  }

  return { ok: true as const, user, supabase };
}

export async function cancelMfaLogin(
  persona: MfaPersona,
): Promise<MfaActionResult> {
  void persona;
  const supabase = await getAuthedSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userId = session?.user?.id;
  if (userId && session?.access_token && session.refresh_token) {
    await deleteLoginMfaSessionForKey(
      userId,
      await deriveSessionKeyFromAuthSession(session),
    );
    await revokeLoginMfaSessions(userId);
  }

  await completePlatformSignOut();
  return { ok: true };
}

async function logMfaLoginSuccess(
  persona: MfaPersona,
  authUserId: string,
  email: string,
  ip: string,
  method: "sms_mfa" | "totp_mfa",
): Promise<void> {
  const tenantId = await resolveAuthActivityTenantId({
    persona,
    authUserId,
  });
  logAuthActivity({
    persona,
    eventName: "login.mfa_success",
    status: "success",
    email,
    ip,
    tenantId,
    authUserId,
    method,
  });
}

async function logMfaLoginFailure(
  persona: MfaPersona,
  options: {
    email: string;
    ip: string;
    authUserId?: string;
    tenantId?: string | null;
    method: "sms_mfa" | "totp_mfa";
    failureReason: string;
    rateLimited?: boolean;
  },
): Promise<void> {
  logAuthActivity({
    persona,
    eventName: options.rateLimited
      ? "login.rate_limited"
      : "login.mfa_failure",
    status: "failure",
    email: options.email,
    ip: options.ip,
    tenantId: options.tenantId,
    authUserId: options.authUserId,
    method: options.method,
    failureReason: options.failureReason,
  });
}

export async function verifyMfaTotpCode(
  code: string,
  persona: MfaPersona,
): Promise<MfaActionResult> {
  const supabase = await getAuthedSupabase();
  const auth = await requireAuthedUser(supabase);
  if (!auth.ok) return auth;

  const headerStore = await headers();
  const ip = getRequestIp(headerStore);
  const email = auth.user.email ?? "";

  const allowed = await assertMfaVerifyAllowed(email, ip);
  if (!allowed.ok) {
    await logMfaLoginFailure(persona, {
      email,
      ip,
      authUserId: auth.user.id,
      method: "totp_mfa",
      failureReason: MFA_VERIFY_RATE_LIMIT_MESSAGE,
      rateLimited: true,
    });
    return allowed;
  }

  const result = await verifyTotpLoginCode(supabase, code);
  if (!result.ok) {
    await recordFailedMfaVerifyAttempt(email, ip);
    const tenantId = await resolveAuthActivityTenantId({
      persona,
      authUserId: auth.user.id,
    });
    await logMfaLoginFailure(persona, {
      email,
      ip,
      authUserId: auth.user.id,
      tenantId,
      method: "totp_mfa",
      failureReason: result.error,
    });
    return result;
  }

  await logMfaLoginSuccess(persona, auth.user.id, email, ip, "totp_mfa");
  return { ok: true };
}

export async function sendMfaLoginSmsOtp(
  persona: MfaPersona,
): Promise<MfaActionResult> {
  void persona;
  const supabase = await getAuthedSupabase();
  const auth = await requireAuthedUser(supabase);
  if (!auth.ok) return auth;

  const phoneE164 = await resolveEnrolledSmsPhone(auth.user.id);
  if (!phoneE164) {
    return {
      ok: false,
      error: "SMS two-factor is enabled but no verified phone is on file.",
    };
  }

  const headerStore = await headers();
  const ip = getRequestIp(headerStore);

  const allowed = await assertMfaResendAllowed(auth.user.id);
  if (!allowed.ok) return allowed;

  const sent = await createAndSendSmsOtpChallenge({
    authUid: auth.user.id,
    phoneE164,
    purpose: "login",
    requestIp: ip,
  });

  if (!sent.ok) {
    return sent;
  }

  await recordMfaResend(auth.user.id);
  return { ok: true };
}

export async function verifyMfaSmsCode(
  code: string,
  persona: MfaPersona,
): Promise<MfaActionResult> {
  const supabase = await getAuthedSupabase();
  const auth = await requireAuthedUser(supabase);
  if (!auth.ok) return auth;

  const headerStore = await headers();
  const ip = getRequestIp(headerStore);
  const email = auth.user.email ?? "";

  const allowed = await assertMfaVerifyAllowed(email, ip);
  if (!allowed.ok) {
    await logMfaLoginFailure(persona, {
      email,
      ip,
      authUserId: auth.user.id,
      method: "sms_mfa",
      failureReason: MFA_VERIFY_RATE_LIMIT_MESSAGE,
      rateLimited: true,
    });
    return allowed;
  }

  const verified = await verifySmsOtpChallenge({
    authUid: auth.user.id,
    purpose: "login",
    code,
  });

  if (!verified.ok) {
    await recordFailedMfaVerifyAttempt(email, ip);
    const tenantId = await resolveAuthActivityTenantId({
      persona,
      authUserId: auth.user.id,
    });
    await logMfaLoginFailure(persona, {
      email,
      ip,
      authUserId: auth.user.id,
      tenantId,
      method: "sms_mfa",
      failureReason: verified.error,
    });
    return verified;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token || !session.refresh_token) {
    return { ok: false, error: "Session expired. Sign in again." };
  }

  const expiresAt = session.expires_at
    ? new Date(session.expires_at * 1000).toISOString()
    : new Date(Date.now() + 3600_000).toISOString();

  try {
    await createLoginMfaSession({
      authUid: auth.user.id,
      sessionKey: await deriveSessionKeyFromAuthSession(session),
      expiresAt,
    });
  } catch (error) {
    console.error(
      "[mfa] createLoginMfaSession failed:",
      error instanceof Error ? error.message : error,
    );
    return {
      ok: false,
      error: "Could not complete sign-in. Please try again.",
    };
  }

  await logMfaLoginSuccess(persona, auth.user.id, email, ip, "sms_mfa");
  return { ok: true };
}

export async function getMfaChallengeContext(persona: MfaPersona): Promise<
  | {
      ok: true;
      method: "totp" | "sms";
      maskedPhone?: string;
      email: string;
    }
  | { ok: false; error: string }
> {
  void persona;
  const supabase = await getAuthedSupabase();
  const auth = await requireAuthedUser(supabase);
  if (!auth.ok) return auth;

  const { getUserMfaSettings } = await import("./aal-gate");
  const settings = await getUserMfaSettings(auth.user.id, supabase);
  const method = settings?.method;

  if (method !== "totp" && method !== "sms") {
    return { ok: false, error: "Two-factor authentication is not enabled." };
  }

  if (method === "sms" && settings?.sms_phone_e164) {
    const { maskPhoneE164 } = await import("./phone-utils");
    return {
      ok: true,
      method: "sms",
      maskedPhone: maskPhoneE164(settings.sms_phone_e164),
      email: auth.user.email ?? "",
    };
  }

  return {
    ok: true,
    method: "totp",
    email: auth.user.email ?? "",
  };
}
