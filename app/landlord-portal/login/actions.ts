"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  assertLoginAllowed,
  getRequestIp,
  recordFailedLoginAttempt,
} from "@/utils/login-rate-limit";

export type LandlordPortalLoginActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Landlord portal login — same rate-limit pattern as Tenant Portal, but requires
 * landlords.auth_user_id + approval_status = approved.
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

  if (!landlord || landlord.approval_status !== "approved") {
    await supabase.auth.signOut();
    return {
      ok: false,
      error:
        "This account is not registered for the Landlord Portal. Use the staff or Tenant Portal login if that applies to you.",
    };
  }

  return { ok: true };
}
