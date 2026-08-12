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

/** True when password_updated_at is on or after the policy rollout cutoff. */
export function isPasswordUpdatedAtCompliant(
  passwordUpdatedAt: string | null | undefined,
): boolean {
  if (!passwordUpdatedAt?.trim()) {
    return false;
  }
  const updatedMs = new Date(passwordUpdatedAt).getTime();
  if (Number.isNaN(updatedMs)) {
    return false;
  }
  return updatedMs >= getPasswordPolicyRolloutDate().getTime();
}

/** True when the user has not set a password since the policy rollout date. */
export async function needsPasswordUpdateNudge(authUid: string): Promise<boolean> {
  const updatedAt = await getPasswordUpdatedAt(authUid);
  return !isPasswordUpdatedAtCompliant(updatedAt);
}
