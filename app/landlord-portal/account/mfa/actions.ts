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

export async function landlordGetMfaSettings() {
  return getMfaSettingsForCurrentUser("landlord");
}

export async function landlordStartTotpEnrollment() {
  return startTotpEnrollment();
}

export async function landlordConfirmTotpEnrollment(factorId: string, code: string) {
  return confirmTotpEnrollment(factorId, code);
}

export async function landlordSendSmsEnrollmentOtp(phoneOverride?: string) {
  return sendSmsEnrollmentOtp("landlord", phoneOverride);
}

export async function landlordConfirmSmsEnrollment(code: string, phoneOverride?: string) {
  return confirmSmsEnrollment("landlord", code, phoneOverride);
}

export async function landlordDisableMfa(code: string) {
  return disableMfa("landlord", code);
}

export async function landlordSendDisableSmsOtp() {
  return sendMfaLoginSmsOtp("landlord");
}
