"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  assertLoginAllowed,
  getRequestIp,
  recordFailedLoginAttempt,
} from "@/utils/login-rate-limit";
import { evaluatePostPasswordMfa } from "@/lib/mfa/post-login";
import { mfaDebugLog } from "@/lib/mfa/debug-log";
import type { LoginWithMfaResult } from "@/lib/mfa/types";

export type LandlordPortalLoginActionResult = LoginWithMfaResult;

/**
 * Landlord portal login — rate-limited like Tenant Portal.
 * Allows approved and pending landlords (pending see Pending Approval UI).
 * Rejected accounts can sign in to see a clear rejected state.
 */
export async function landlordPortalLoginWithPassword(
  email: string,
  password: string,
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
  const supabase = createClient(cookieStore);

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

  // Login is allowed for pending/approved/rejected; data access is gated separately.
  mfaDebugLog("landlord.login.actions.beforeMfaEval", {
    email: trimmedEmail,
    authUid: signInData.user.id,
    pathname: "landlord-portal",
  });

  const mfa = await evaluatePostPasswordMfa(signInData.user.id, trimmedEmail);

  mfaDebugLog("landlord.login.actions.afterMfaEval", {
    email: trimmedEmail,
    authUid: signInData.user.id,
    mfa,
  });

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
