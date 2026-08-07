import { createClient } from "@supabase/supabase-js";

export { deriveSessionKeyFromAuthSession } from "./session-key";

function createMfaServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase service role credentials for MFA session lookup.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function hasValidLoginMfaSession(
  authUid: string,
  sessionKey: string,
): Promise<boolean> {
  const admin = createMfaServiceClient();
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("login_mfa_sessions")
    .select("verified_at, expires_at")
    .eq("auth_uid", authUid)
    .eq("session_key", sessionKey)
    .maybeSingle();

  if (error || !data) {
    return false;
  }

  return data.expires_at > now;
}

export async function createLoginMfaSession(options: {
  authUid: string;
  sessionKey: string;
  expiresAt: string;
}): Promise<void> {
  const admin = createMfaServiceClient();
  const { error } = await admin.from("login_mfa_sessions").upsert(
    {
      auth_uid: options.authUid,
      session_key: options.sessionKey,
      method: "sms",
      verified_at: new Date().toISOString(),
      expires_at: options.expiresAt,
    },
    { onConflict: "auth_uid,session_key" },
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function revokeLoginMfaSessions(authUid: string): Promise<void> {
  const admin = createMfaServiceClient();
  await admin.from("login_mfa_sessions").delete().eq("auth_uid", authUid);
}

export async function deleteLoginMfaSessionForKey(
  authUid: string,
  sessionKey: string,
): Promise<void> {
  const admin = createMfaServiceClient();
  await admin
    .from("login_mfa_sessions")
    .delete()
    .eq("auth_uid", authUid)
    .eq("session_key", sessionKey);
}
