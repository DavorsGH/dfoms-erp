"use server";

import {
  cancelMfaLogin,
  getMfaChallengeContext,
  sendMfaLoginSmsOtp,
  verifyMfaSmsCode,
  verifyMfaTotpCode,
} from "@/lib/mfa/challenge-actions";

export async function portalGetMfaChallengeContext() {
  return getMfaChallengeContext("lessee");
}

export async function portalVerifyMfaTotp(code: string) {
  return verifyMfaTotpCode(code, "lessee");
}

export async function portalSendMfaLoginSms() {
  return sendMfaLoginSmsOtp("lessee");
}

export async function portalVerifyMfaSms(code: string) {
  return verifyMfaSmsCode(code, "lessee");
}

export async function portalCancelMfaLogin() {
  return cancelMfaLogin("lessee");
}
