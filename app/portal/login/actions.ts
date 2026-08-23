"use server";

import { cookies, headers } from "next/headers";
import { setAuthPersistPreference } from "@/lib/auth/sign-out";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  assertLoginAllowed,
  getRequestIp,
  recordFailedLoginAttempt,
} from "@/utils/login-rate-limit";
import { isAuthUserBanned } from "@/utils/lessee-portal-account-management";
import { evaluatePostPasswordMfa } from "@/lib/mfa/post-login";
import { syncAuthUserPortalMetadata } from "@/lib/auth/portal-metadata";
import {
  logAuthActivity,
} from "@/lib/user-activity-log";
import { LOGIN_RATE_LIMIT_MESSAGE } from "@/utils/login-rate-limit";
import type { LoginWithMfaResult } from "@/lib/mfa/types";

export type PortalLoginActionResult = LoginWithMfaResult;

/**
 * Tenant portal login — same rate-limit pattern as staff /login, but requires
 * the auth user to be linked on a lessees.auth_user_id row.
 */
export async function portalLoginWithPassword(
  email: string,
  password: string,
  stayLoggedIn = false,
): Promise<PortalLoginActionResult> {
  const headerStore = await headers();
  const ip = getRequestIp(headerStore);
  const trimmedEmail = email.trim();

  if (!trimmedEmail || !password) {
    logAuthActivity({
      persona: "lessee",
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
      persona: "lessee",
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

  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });

  if (error || !signInData.user) {
    await recordFailedLoginAttempt(trimmedEmail, ip);
    logAuthActivity({
      persona: "lessee",
      eventName: "login.password_failure",
      status: "failure",
      email: trimmedEmail,
      ip,
      method: "password",
      failureReason: error?.message ?? "invalid_credentials",
    });
    return { ok: false, error: error?.message ?? "Invalid email or password." };
  }

  const admin = createAdminClient();
  const { data: lessee, error: lesseeError } = await admin
    .from("lessees")
    .select("lessee_id, tenant_id")
    .eq("auth_user_id", signInData.user.id)
    .neq("status", "former")
    .maybeSingle();

  if (lesseeError) {
    await supabase.auth.signOut();
    logAuthActivity({
      persona: "lessee",
      eventName: "login.password_failure",
      status: "failure",
      email: trimmedEmail,
      ip,
      authUserId: signInData.user.id,
      method: "password",
      failureReason: lesseeError.message,
    });
    return { ok: false, error: lesseeError.message };
  }

  if (!lessee) {
    await supabase.auth.signOut();
    logAuthActivity({
      persona: "lessee",
      eventName: "login.password_failure",
      status: "failure",
      email: trimmedEmail,
      ip,
      authUserId: signInData.user.id,
      method: "password",
      failureReason: "wrong_portal",
    });
    return {
      ok: false,
      error:
        "This account is not registered for the Tenant Portal. Use the staff login if you are a Davors user.",
    };
  }

  const { data: authUserData } = await admin.auth.admin.getUserById(
    signInData.user.id,
  );
  const bannedUntil =
    (authUserData?.user as { banned_until?: string | null } | undefined)
      ?.banned_until ?? null;
  if (isAuthUserBanned(bannedUntil)) {
    await supabase.auth.signOut();
    logAuthActivity({
      persona: "lessee",
      eventName: "login.password_failure",
      status: "failure",
      email: trimmedEmail,
      ip,
      tenantId: lessee.tenant_id,
      authUserId: signInData.user.id,
      method: "password",
      failureReason: "account_deactivated",
    });
    return {
      ok: false,
      error:
        "This portal account has been deactivated. Contact your landlord or property manager.",
    };
  }

  const mfa = await evaluatePostPasswordMfa(signInData.user.id);
  if (mfa.mfaRequired) {
    return {
      ok: true,
      mfaRequired: true,
      method: mfa.method,
      maskedPhone: mfa.maskedPhone,
    };
  }

  await syncAuthUserPortalMetadata(signInData.user.id, "lessee");

  logAuthActivity({
    persona: "lessee",
    eventName: "login.password_success",
    status: "success",
    email: trimmedEmail,
    ip,
    tenantId: lessee.tenant_id,
    authUserId: signInData.user.id,
    method: "password",
  });

  return { ok: true };
}
