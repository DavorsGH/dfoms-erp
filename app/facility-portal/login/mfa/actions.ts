"use server";

import {
  cancelMfaLogin,
  getMfaChallengeContext,
  sendMfaLoginSmsOtp,
  verifyMfaSmsCode,
  verifyMfaTotpCode,
} from "@/lib/mfa/challenge-actions";

export async function facilityGetMfaChallengeContext() {
  return getMfaChallengeContext("facility_manager");
}

export async function facilityVerifyMfaTotp(code: string) {
  return verifyMfaTotpCode(code, "facility_manager");
}

export async function facilitySendMfaLoginSms() {
  return sendMfaLoginSmsOtp("facility_manager");
}

export async function facilityVerifyMfaSms(code: string) {
  return verifyMfaSmsCode(code, "facility_manager");
}

export async function facilityCancelMfaLogin() {
  return cancelMfaLogin("facility_manager");
}
