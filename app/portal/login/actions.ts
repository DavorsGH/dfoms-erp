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
  const { data: lessee, error: lesseeError } = await admin
    .from("lessees")
    .select("lessee_id")
    .eq("auth_user_id", signInData.user.id)
    .maybeSingle();

  if (lesseeError) {
    await supabase.auth.signOut();
    return { ok: false, error: lesseeError.message };
  }

  if (!lessee) {
    await supabase.auth.signOut();
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

  return { ok: true };
}
