import { getUserMfaSettings } from "./aal-gate";
import { isMfaEnforcementEnabledAtRuntime } from "./config";
import { mfaDebugLog } from "./debug-log";
import { maskPhoneE164 } from "./phone-utils";
import { resolveEnrolledSmsPhone } from "./sms-phone";
import type { PostLoginMfaResult } from "./types";

export async function evaluatePostPasswordMfa(
  authUid: string,
  emailForLog?: string,
): Promise<PostLoginMfaResult> {
  const enforcementOn = await isMfaEnforcementEnabledAtRuntime();

  if (!enforcementOn) {
    mfaDebugLog("post-login.evaluatePostPasswordMfa", {
      authUid,
      email: emailForLog ?? null,
      path: "enforcement_off",
      result: { mfaRequired: false },
    });
    return { mfaRequired: false };
  }

  const settings = await getUserMfaSettings(authUid);
  const method = settings?.method ?? "none";

  if (method === "none") {
    mfaDebugLog("post-login.evaluatePostPasswordMfa", {
      authUid,
      email: emailForLog ?? null,
      path: "method_none",
      settings,
      result: { mfaRequired: false },
    });
    return { mfaRequired: false };
  }

  if (method === "totp") {
    const result = { mfaRequired: true as const, method: "totp" as const };
    mfaDebugLog("post-login.evaluatePostPasswordMfa", {
      authUid,
      email: emailForLog ?? null,
      path: "totp_required",
      settings,
      result,
    });
    return result;
  }

  if (method === "sms") {
    const enrolledPhone = await resolveEnrolledSmsPhone(authUid);
    const result = {
      mfaRequired: true as const,
      method: "sms" as const,
      maskedPhone: enrolledPhone ? maskPhoneE164(enrolledPhone) : undefined,
    };
    mfaDebugLog("post-login.evaluatePostPasswordMfa", {
      authUid,
      email: emailForLog ?? null,
      path: "sms_required",
      settings,
      enrolledPhone: enrolledPhone ?? null,
      result,
    });
    return result;
  }

  mfaDebugLog("post-login.evaluatePostPasswordMfa", {
    authUid,
    email: emailForLog ?? null,
    path: "fallback_none",
    settings,
    result: { mfaRequired: false },
  });
  return { mfaRequired: false };
}
