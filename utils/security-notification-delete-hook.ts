import "server-only";

import { SECURITY_NOTIFICATION } from "@/utils/security-notifications";
import {
  MFA_ENROLLMENT_NUDGE_TYPE,
  PASSWORD_UPDATE_NUDGE_TYPE,
  recordSecurityNudgeDismissal,
  type SecurityNudgeType,
} from "@/utils/security-notification-dismissals";

function nudgeTypeForTitle(title: string | null | undefined): SecurityNudgeType | null {
  const trimmed = title?.trim();
  if (trimmed === SECURITY_NOTIFICATION.mfaTitle) {
    return MFA_ENROLLMENT_NUDGE_TYPE;
  }
  if (trimmed === SECURITY_NOTIFICATION.passwordTitle) {
    return PASSWORD_UPDATE_NUDGE_TYPE;
  }
  return null;
}

/** After a notification delete, start security nudge cooldown when applicable. */
export async function afterSecurityNotificationDeleted(options: {
  authUid: string;
  title: string | null | undefined;
}): Promise<void> {
  const nudgeType = nudgeTypeForTitle(options.title);
  if (!nudgeType) {
    return;
  }

  await recordSecurityNudgeDismissal(options.authUid, nudgeType);
}
