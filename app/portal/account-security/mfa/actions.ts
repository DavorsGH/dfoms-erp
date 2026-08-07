"use server";

import {
  confirmSmsEnrollment,
  confirmTotpEnrollment,
  disableMfa,
  getMfaSettingsForCurrentUser,
  sendSmsEnrollmentOtp,
  startTotpEnrollment,
} from "@/lib/mfa/enrollment-actions";
import { sendMfaLoginSmsOtp } from "@/lib/mfa/challenge-actions";

export async function portalGetMfaSettings() {
  return getMfaSettingsForCurrentUser("lessee");
}

export async function portalStartTotpEnrollment() {
  return startTotpEnrollment();
}

export async function portalConfirmTotpEnrollment(factorId: string, code: string) {
  return confirmTotpEnrollment(factorId, code);
}

export async function portalSendSmsEnrollmentOtp(phoneOverride?: string) {
  return sendSmsEnrollmentOtp("lessee", phoneOverride);
}

export async function portalConfirmSmsEnrollment(code: string, phoneOverride?: string) {
  return confirmSmsEnrollment("lessee", code, phoneOverride);
}

export async function portalDisableMfa(code: string) {
  return disableMfa("lessee", code);
}

export async function portalSendDisableSmsOtp() {
  return sendMfaLoginSmsOtp("lessee");
}
