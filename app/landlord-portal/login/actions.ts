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
import { evaluatePostPasswordMfa } from "@/lib/mfa/post-login";
import { syncAuthUserPortalMetadata } from "@/lib/auth/portal-metadata";
import type { LoginWithMfaResult } from "@/lib/mfa/types";
import { isAuthUserBanned } from "@/utils/lessee-portal-account-management";

export type LandlordPortalLoginActionResult = LoginWithMfaResult;

/**
 * Landlord portal login — rate-limited like Tenant Portal.
 * Allows approved, pending, and rejected landlords (inactive states see limited UI).
 * Suspended accounts and Auth-banned users cannot sign in.
 */
export async function landlordPortalLoginWithPassword(
  email: string,
  password: string,
  stayLoggedIn = false,
): Promise<LandlordPortalLoginActionResult> {
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
  await setAuthPersistPreference(stayLoggedIn);
  const supabase = createClient(cookieStore, { authPersist: stayLoggedIn });

  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });

  if (error || !signInData.user) {
    await recordFailedLoginAttempt(trimmedEmail, ip);
    return { ok: false, error: error?.message ?? "Invalid email or password." };
  }

  const admin = createAdminClient();
  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("tenant_id, approval_status")
    .eq("auth_user_id", signInData.user.id)
    .maybeSingle();

  if (landlordError) {
    await supabase.auth.signOut();
    return { ok: false, error: landlordError.message };
  }

  if (!landlord) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error:
        "This account is not registered for the Landlord Portal. Use the staff or Tenant Portal login if that applies to you.",
    };
  }

  if (landlord.approval_status === "suspended") {
    await supabase.auth.signOut();
    return {
      ok: false,
      error:
        "Your landlord portal access has been suspended. Contact Davors Facilities staff.",
    };
  }

  const { data: authUserData, error: authUserError } =
    await admin.auth.admin.getUserById(signInData.user.id);
  if (authUserError) {
    await supabase.auth.signOut();
    return { ok: false, error: authUserError.message };
  }
  if (isAuthUserBanned(authUserData.user?.banned_until)) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error:
        "Your landlord portal access has been suspended. Contact Davors Facilities staff.",
    };
  }

  // Login is allowed for pending/approved/rejected; data access is gated separately.
  const mfa = await evaluatePostPasswordMfa(signInData.user.id);
  if (mfa.mfaRequired) {
    return {
      ok: true,
      mfaRequired: true,
      method: mfa.method,
      maskedPhone: mfa.maskedPhone,
    };
  }

  await syncAuthUserPortalMetadata(signInData.user.id, "landlord");

  return { ok: true };
}
