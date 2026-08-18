"use server";

import { cookies, headers } from "next/headers";
import { setAuthPersistPreference } from "@/lib/auth/sign-out";
import { createClient } from "@/utils/supabase/server";
import {
  assertLoginAllowed,
  getRequestIp,
  recordFailedLoginAttempt,
} from "@/utils/login-rate-limit";
import { evaluatePostPasswordMfa } from "@/lib/mfa/post-login";
import { syncStaffPortalMetadataAfterLogin } from "@/lib/auth/portal-metadata";
import {
  logAuthActivity,
  resolveAuthActivityTenantId,
} from "@/lib/user-activity-log";
import { LOGIN_RATE_LIMIT_MESSAGE } from "@/utils/login-rate-limit";
import type { LoginWithMfaResult } from "@/lib/mfa/types";

export type LoginActionResult = LoginWithMfaResult;

/**
 * Server-side login so Upstash rate limits can run before Supabase Auth and
 * only failed attempts are recorded. Optional Turnstile token is forwarded to
 * Supabase when the client has already required CAPTCHA after failed attempts.
 */
export async function loginWithPassword(
  email: string,
  password: string,
  stayLoggedIn = false,
  captchaToken?: string | null,
): Promise<LoginActionResult> {
  const headerStore = await headers();
  const ip = getRequestIp(headerStore);
  const trimmedEmail = email.trim();

  if (!trimmedEmail || !password) {
    logAuthActivity({
      persona: "staff",
      eventName: "login.password_failure",
      status: "failure",
      email: trimmedEmail || email,
      ip,
      method: "password",
      failureReason: "missing_credentials",
    });
    return { ok: false, error: "Email and password are required." };
  }

  const allowed = await assertLoginAllowed(trimmedEmail, ip);
  if (!allowed.ok) {
    logAuthActivity({
      persona: "staff",
      eventName: "login.rate_limited",
      status: "failure",
      email: trimmedEmail,
      ip,
      method: "password",
      failureReason: LOGIN_RATE_LIMIT_MESSAGE,
    });
    return allowed;
  }

  const cookieStore = await cookies();
  await setAuthPersistPreference(stayLoggedIn);
  const supabase = createClient(cookieStore, { authPersist: stayLoggedIn });

  const trimmedCaptcha = captchaToken?.trim() || undefined;

  const { error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
    ...(trimmedCaptcha
      ? { options: { captchaToken: trimmedCaptcha } }
      : {}),
  });

  if (error) {
    await recordFailedLoginAttempt(trimmedEmail, ip);

    const message = error.message?.toLowerCase() ?? "";
    if (
      message.includes("captcha") ||
      message.includes("turnstile") ||
      error.code === "captcha_failed"
    ) {
      logAuthActivity({
        persona: "staff",
        eventName: "login.password_failure",
        status: "failure",
        email: trimmedEmail,
        ip,
        method: "password",
        failureReason: "captcha_failed",
      });
      return {
        ok: false,
        error:
          "CAPTCHA verification failed or expired. Please complete the check and try again.",
      };
    }

    logAuthActivity({
      persona: "staff",
      eventName: "login.password_failure",
      status: "failure",
      email: trimmedEmail,
      ip,
      method: "password",
      failureReason: error.message,
    });
    return { ok: false, error: error.message };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const mfa = await evaluatePostPasswordMfa(user.id);

    if (mfa.mfaRequired) {
      return {
        ok: true,
        mfaRequired: true,
        method: mfa.method,
        maskedPhone: mfa.maskedPhone,
      };
    }

    await syncStaffPortalMetadataAfterLogin(user.id);
    const tenantId = await resolveAuthActivityTenantId({
      persona: "staff",
      authUserId: user.id,
    });
    logAuthActivity({
      persona: "staff",
      eventName: "login.password_success",
      status: "success",
      email: trimmedEmail,
      ip,
      tenantId,
      authUserId: user.id,
      method: "password",
    });
  }

  return { ok: true };
}
