"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  assertLoginAllowed,
  getRequestIp,
  recordFailedLoginAttempt,
} from "@/utils/login-rate-limit";
import { evaluatePostPasswordMfa } from "@/lib/mfa/post-login";
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
  captchaToken?: string | null,
): Promise<LoginActionResult> {
  const trimmedEmail = email.trim();
  if (!trimmedEmail || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  const headerStore = await headers();
  const ip = getRequestIp(headerStore);

  const allowed = await assertLoginAllowed(trimmedEmail, ip);
  if (!allowed.ok) {
    return allowed;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

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
      return {
        ok: false,
        error:
          "CAPTCHA verification failed or expired. Please complete the check and try again.",
      };
    }

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
  }

  return { ok: true };
}
