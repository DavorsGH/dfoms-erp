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

export async function staffGetMfaSettings() {
  return getMfaSettingsForCurrentUser("staff");
}

export type StaffMfaSettings = Awaited<ReturnType<typeof staffGetMfaSettings>>;

export async function staffStartTotpEnrollment() {
  return startTotpEnrollment();
}

export async function staffConfirmTotpEnrollment(factorId: string, code: string) {
  return confirmTotpEnrollment(factorId, code);
}

export async function staffSendSmsEnrollmentOtp(phoneOverride?: string) {
  return sendSmsEnrollmentOtp("staff", phoneOverride);
}

export async function staffConfirmSmsEnrollment(code: string, phoneOverride?: string) {
  return confirmSmsEnrollment("staff", code, phoneOverride);
}

export async function staffDisableMfa(code: string) {
  return disableMfa("staff", code);
}

export async function staffSendDisableSmsOtp() {
  return sendMfaLoginSmsOtp("staff");
}
