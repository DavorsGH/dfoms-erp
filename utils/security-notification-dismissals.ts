import { createAdminClient } from "@/utils/supabase/admin";

/** Cooldown after deleting a security nudge before it may reappear. */
export const SECURITY_NUDGE_COOLDOWN_DAYS = 30;

export const MFA_ENROLLMENT_NUDGE_TYPE = "mfa_enrollment" as const;
export const PASSWORD_UPDATE_NUDGE_TYPE = "password_update" as const;

export type SecurityNudgeType =
  | typeof MFA_ENROLLMENT_NUDGE_TYPE
  | typeof PASSWORD_UPDATE_NUDGE_TYPE;

function cooldownCutoffIso(days: number): string {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

/** True when the user deleted this nudge within the cooldown window. */
export async function isSecurityNudgeInCooldown(
  authUid: string,
  nudgeType: SecurityNudgeType,
  cooldownDays = SECURITY_NUDGE_COOLDOWN_DAYS,
): Promise<boolean> {
  const cleaned = authUid.trim();
  if (!cleaned) {
    return false;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("security_notification_dismissals")
    .select("dismissed_at")
    .eq("auth_uid", cleaned)
    .eq("nudge_type", nudgeType)
    .maybeSingle();

  if (error) {
    console.error(
      `[security-notification-dismissals] cooldown read failed (${nudgeType}):`,
      error.message,
    );
    return false;
  }

  if (!data?.dismissed_at) {
    return false;
  }

  return data.dismissed_at >= cooldownCutoffIso(cooldownDays);
}

/** Record that the user deleted a security nudge (starts cooldown). */
export async function recordSecurityNudgeDismissal(
  authUid: string,
  nudgeType: SecurityNudgeType,
): Promise<void> {
  const cleaned = authUid.trim();
  if (!cleaned) {
    return;
  }

  const now = new Date().toISOString();
  const admin = createAdminClient();
  const { error } = await admin.from("security_notification_dismissals").upsert(
    {
      auth_uid: cleaned,
      nudge_type: nudgeType,
      dismissed_at: now,
      updated_at: now,
    },
    { onConflict: "auth_uid,nudge_type" },
  );

  if (error) {
    console.error(
      `[security-notification-dismissals] record failed (${nudgeType}):`,
      error.message,
    );
  }
}
