"use client";

import MfaLoginChallengeForm from "@/components/mfa/mfa-login-challenge-form";
import {
  landlordCancelMfaLogin,
  landlordGetMfaChallengeContext,
  landlordSendMfaLoginSms,
  landlordVerifyMfaSms,
  landlordVerifyMfaTotp,
} from "./actions";

export default function LandlordMfaLoginPage() {
  return (
    <MfaLoginChallengeForm
      persona="landlord"
      title="Landlord portal verification"
      loginPath="/landlord-portal/login"
      actions={{
        getContext: landlordGetMfaChallengeContext,
        verifyTotp: landlordVerifyMfaTotp,
        sendSms: landlordSendMfaLoginSms,
        verifySms: landlordVerifyMfaSms,
        cancel: landlordCancelMfaLogin,
      }}
    />
  );
}
