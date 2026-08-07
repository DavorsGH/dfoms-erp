import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { isMfaEnforcementEnabled } from "./config";
import { hasValidLoginMfaSession } from "./mfa-session";
import { isTotpMfaSatisfied } from "./totp";
import type { MfaGateStatus, MfaMethod, UserMfaSettingsRow } from "./types";

function createMfaServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getUserMfaSettings(
  authUid: string,
  supabase?: SupabaseClient,
): Promise<UserMfaSettingsRow | null> {
  const client = supabase ?? createMfaServiceClient();
  if (!client) return null;
  const { data, error } = await client
    .from("user_mfa_settings")
    .select(
      "auth_uid, method, sms_phone_e164, sms_phone_verified_at, totp_enrolled_at, updated_at",
    )
    .eq("auth_uid", authUid)
    .maybeSingle();

  if (error) {
    console.error("[mfa] getUserMfaSettings:", error.message);
    return null;
  }

  return data as UserMfaSettingsRow | null;
}

export async function getMfaGateStatus(
  supabase: SupabaseClient,
  authUid: string,
  sessionKey: string | null,
): Promise<MfaGateStatus> {
  if (!isMfaEnforcementEnabled()) {
    return "not_required";
  }

  const settings = await getUserMfaSettings(authUid, supabase);
  const method: MfaMethod = settings?.method ?? "none";

  if (method === "none") {
    return "not_required";
  }

  if (method === "totp") {
    const satisfied = await isTotpMfaSatisfied(supabase);
    return satisfied ? "satisfied" : "pending";
  }

  if (method === "sms") {
    if (!sessionKey) {
      return "pending";
    }
    const valid = await hasValidLoginMfaSession(authUid, sessionKey);
    return valid ? "satisfied" : "pending";
  }

  return "not_required";
}
