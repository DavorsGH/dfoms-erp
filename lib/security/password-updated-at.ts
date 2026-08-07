import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import { getPasswordPolicyRolloutDate } from "@/utils/password-policy";

export async function recordPasswordUpdatedAt(authUid: string): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("user_auth_security").upsert(
    {
      auth_uid: authUid,
      password_updated_at: now,
      updated_at: now,
    },
    { onConflict: "auth_uid" },
  );

  if (error) {
    console.error(
      "[password-updated-at] upsert failed:",
      error.message,
      authUid,
    );
  }
}

export async function getPasswordUpdatedAt(
  authUid: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_auth_security")
    .select("password_updated_at")
    .eq("auth_uid", authUid)
    .maybeSingle();

  if (error) {
    console.error("[password-updated-at] read failed:", error.message, authUid);
    return null;
  }

  return data?.password_updated_at ?? null;
}

/** True when the user has not set a password since the policy rollout date. */
export async function needsPasswordUpdateNudge(authUid: string): Promise<boolean> {
  const updatedAt = await getPasswordUpdatedAt(authUid);
  if (!updatedAt) {
    return true;
  }
  const rollout = getPasswordPolicyRolloutDate();
  return new Date(updatedAt).getTime() < rollout.getTime();
}
