"use server";

import { cookies, headers } from "next/headers";
import { setAuthPersistPreference } from "@/lib/auth/sign-out";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  assertLoginAllowed,
  getRequestIp,
  recordFailedLoginAttempt,
  LOGIN_RATE_LIMIT_MESSAGE,
} from "@/utils/login-rate-limit";
import { isAuthUserBanned } from "@/utils/lessee-portal-account-management";
import { evaluatePostPasswordMfa } from "@/lib/mfa/post-login";
import { syncAuthUserPortalMetadata } from "@/lib/auth/portal-metadata";
import { logAuthActivity } from "@/lib/user-activity-log";
import type { LoginWithMfaResult } from "@/lib/mfa/types";

export type FacilityPortalLoginActionResult = LoginWithMfaResult;

/**
 * Facility Manager portal login — requires an active facility_managers.auth_user_id link.
 */
export async function facilityPortalLoginWithPassword(
  email: string,
  password: string,
  stayLoggedIn = false,
): Promise<FacilityPortalLoginActionResult> {
  const headerStore = await headers();
  const ip = getRequestIp(headerStore);
  const trimmedEmail = email.trim();

  if (!trimmedEmail || !password) {
    logAuthActivity({
      persona: "facility_manager",
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
      persona: "facility_manager",
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
      persona: "facility_manager",
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
  const { data: fm, error: fmError } = await admin
    .from("facility_managers")
    .select("facility_manager_id, tenant_id, status")
    .eq("auth_user_id", signInData.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (fmError) {
    await supabase.auth.signOut();
    logAuthActivity({
      persona: "facility_manager",
      eventName: "login.password_failure",
      status: "failure",
      email: trimmedEmail,
      ip,
      authUserId: signInData.user.id,
      method: "password",
      failureReason: fmError.message,
    });
    return { ok: false, error: fmError.message };
  }

  if (!fm) {
    await supabase.auth.signOut();
    logAuthActivity({
      persona: "facility_manager",
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
        "This account belongs to a different portal. Choose the correct portal to continue.",
    };
  }

  const { data: authUserData, error: authUserError } =
    await admin.auth.admin.getUserById(signInData.user.id);
  if (authUserError) {
    await supabase.auth.signOut();
    logAuthActivity({
      persona: "facility_manager",
      eventName: "login.password_failure",
      status: "failure",
      email: trimmedEmail,
      ip,
      tenantId: fm.tenant_id,
      authUserId: signInData.user.id,
      method: "password",
      failureReason: authUserError.message,
    });
    return { ok: false, error: authUserError.message };
  }
  if (isAuthUserBanned(authUserData.user?.banned_until)) {
    await supabase.auth.signOut();
    logAuthActivity({
      persona: "facility_manager",
      eventName: "login.password_failure",
      status: "failure",
      email: trimmedEmail,
      ip,
      tenantId: fm.tenant_id,
      authUserId: signInData.user.id,
      method: "password",
      failureReason: "account_banned",
    });
    return {
      ok: false,
      error:
        "Your Facility Manager access has been suspended. Contact your landlord.",
    };
  }

  await syncAuthUserPortalMetadata(signInData.user.id, "facility_manager");

  const mfa = await evaluatePostPasswordMfa(signInData.user.id);
  if (mfa.mfaRequired) {
    return {
      ok: true,
      mfaRequired: true,
      method: mfa.method,
      maskedPhone: mfa.maskedPhone,
    };
  }

  logAuthActivity({
    persona: "facility_manager",
    eventName: "login.password_success",
    status: "success",
    email: trimmedEmail,
    ip,
    tenantId: fm.tenant_id,
    authUserId: signInData.user.id,
    method: "password",
  });

  return { ok: true };
}
