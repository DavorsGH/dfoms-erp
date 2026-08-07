import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import { getUserMfaSettings } from "./aal-gate";
import type { MfaActionResult, MfaMethod } from "./types";

export type PersistUserMfaSettingsInput = {
  authUid: string;
  method: MfaMethod;
  smsPhoneE164?: string | null;
  smsPhoneVerifiedAt?: string | null;
  totpEnrolledAt?: string | null;
};

/**
 * Persist MFA prefs via service role and verify the row actually updated.
 * Avoids relying on client-session RLS for the enrollment completion write.
 */
export async function persistUserMfaSettings(
  input: PersistUserMfaSettingsInput,
): Promise<MfaActionResult> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { error } = await admin.from("user_mfa_settings").upsert(
    {
      auth_uid: input.authUid,
      method: input.method,
      sms_phone_e164: input.smsPhoneE164 ?? null,
      sms_phone_verified_at: input.smsPhoneVerifiedAt ?? null,
      totp_enrolled_at: input.totpEnrolledAt ?? null,
      updated_at: now,
    },
    { onConflict: "auth_uid" },
  );

  if (error) {
    console.error("[mfa] persistUserMfaSettings upsert:", error.message);
    return { ok: false, error: error.message };
  }

  const verified = await getUserMfaSettings(input.authUid, admin);
  if (!verified || verified.method !== input.method) {
    console.error("[mfa] persistUserMfaSettings verify failed:", {
      authUid: input.authUid,
      expected: input.method,
      actual: verified?.method ?? null,
    });
    return {
      ok: false,
      error: "Two-factor settings could not be saved. Please try again.",
    };
  }

  if (input.method === "sms" && !verified.sms_phone_e164) {
    return {
      ok: false,
      error: "SMS phone number was not saved. Please try again.",
    };
  }

  if (input.method === "totp" && !verified.totp_enrolled_at) {
    return {
      ok: false,
      error: "Authenticator enrollment was not saved. Please try again.",
    };
  }

  return { ok: true };
}
