"use client";

import MfaLoginChallengeForm from "@/components/mfa/mfa-login-challenge-form";
import {
  portalCancelMfaLogin,
  portalGetMfaChallengeContext,
  portalSendMfaLoginSms,
  portalVerifyMfaSms,
  portalVerifyMfaTotp,
} from "./actions";

export default function PortalMfaLoginPage() {
  return (
    <MfaLoginChallengeForm
      persona="lessee"
      title="Tenant portal verification"
      loginPath="/portal/login"
      actions={{
        getContext: portalGetMfaChallengeContext,
        verifyTotp: portalVerifyMfaTotp,
        sendSms: portalSendMfaLoginSms,
        verifySms: portalVerifyMfaSms,
        cancel: portalCancelMfaLogin,
      }}
    />
  );
}
