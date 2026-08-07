import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Friendly name used when enrolling TOTP via `auth.mfa.enroll`. */
export const TOTP_ENROLLMENT_FRIENDLY_NAME = "Authenticator app";

/**
 * Remove incomplete TOTP enrollments left behind when a user closes the
 * setup screen before entering their first verification code.
 */
export async function clearStaleTotpEnrollmentFactors(
  supabase: SupabaseClient,
): Promise<void> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) {
    return;
  }

  const stale = data.all.filter(
    (factor) =>
      factor.factor_type === "totp" && factor.status === "unverified",
  );
  for (const factor of stale) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
}

export async function isTotpMfaSatisfied(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (error || !data) {
    return false;
  }

  return data.currentLevel === "aal2";
}

export async function getVerifiedTotpFactorId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) {
    return null;
  }

  const factor = data.totp.find((row) => row.status === "verified");
  return factor?.id ?? null;
}

export async function verifyTotpLoginCode(
  supabase: SupabaseClient,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const factorId = await getVerifiedTotpFactorId(supabase);
  if (!factorId) {
    return {
      ok: false,
      error: "No authenticator app is enrolled for this account.",
    };
  }

  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return {
      ok: false,
      error: "Enter the 6-digit code from your authenticator app.",
    };
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: trimmed,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  // Flush upgraded AAL2 session into SSR cookies before the client navigates.
  await supabase.auth.getSession();

  return { ok: true };
}
