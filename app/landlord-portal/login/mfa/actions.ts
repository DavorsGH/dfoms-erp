"use server";

import {
  cancelMfaLogin,
  getMfaChallengeContext,
  sendMfaLoginSmsOtp,
  verifyMfaSmsCode,
  verifyMfaTotpCode,
} from "@/lib/mfa/challenge-actions";

export async function landlordGetMfaChallengeContext() {
  return getMfaChallengeContext("landlord");
}

export async function landlordVerifyMfaTotp(code: string) {
  return verifyMfaTotpCode(code, "landlord");
}

export async function landlordSendMfaLoginSms() {
  return sendMfaLoginSmsOtp("landlord");
}

export async function landlordVerifyMfaSms(code: string) {
  return verifyMfaSmsCode(code, "landlord");
}

export async function landlordCancelMfaLogin() {
  return cancelMfaLogin("landlord");
}
