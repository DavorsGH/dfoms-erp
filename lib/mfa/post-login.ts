import { getUserMfaSettings } from "./aal-gate";
import { isMfaEnforcementEnabledAtRuntime } from "./config";
import { maskPhoneE164 } from "./phone-utils";
import { resolveEnrolledSmsPhone } from "./sms-phone";
import type { PostLoginMfaResult } from "./types";

export async function evaluatePostPasswordMfa(
  authUid: string,
): Promise<PostLoginMfaResult> {
  const enforcementOn = await isMfaEnforcementEnabledAtRuntime();

  if (!enforcementOn) {
    return { mfaRequired: false };
  }

  const settings = await getUserMfaSettings(authUid);
  const method = settings?.method ?? "none";

  if (method === "none") {
    return { mfaRequired: false };
  }

  if (method === "totp") {
    return { mfaRequired: true, method: "totp" };
  }

  if (method === "sms") {
    const enrolledPhone = await resolveEnrolledSmsPhone(authUid);
    return {
      mfaRequired: true,
      method: "sms",
      maskedPhone: enrolledPhone ? maskPhoneE164(enrolledPhone) : undefined,
    };
  }

  return { mfaRequired: false };
}
