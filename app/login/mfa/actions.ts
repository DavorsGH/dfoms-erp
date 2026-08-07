"use server";

import {
  cancelMfaLogin,
  getMfaChallengeContext,
  sendMfaLoginSmsOtp,
  verifyMfaSmsCode,
  verifyMfaTotpCode,
} from "@/lib/mfa/challenge-actions";

export async function staffGetMfaChallengeContext() {
  return getMfaChallengeContext("staff");
}

export async function staffVerifyMfaTotp(code: string) {
  return verifyMfaTotpCode(code, "staff");
}

export async function staffSendMfaLoginSms() {
  return sendMfaLoginSmsOtp("staff");
}

export async function staffVerifyMfaSms(code: string) {
  return verifyMfaSmsCode(code, "staff");
}

export async function staffCancelMfaLogin() {
  return cancelMfaLogin("staff");
}
