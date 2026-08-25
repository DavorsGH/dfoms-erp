"use client";

import MfaLoginChallengeForm from "@/components/mfa/mfa-login-challenge-form";
import {
  facilityCancelMfaLogin,
  facilityGetMfaChallengeContext,
  facilitySendMfaLoginSms,
  facilityVerifyMfaSms,
  facilityVerifyMfaTotp,
} from "./actions";

export default function FacilityMfaLoginPage() {
  return (
    <MfaLoginChallengeForm
      persona="facility_manager"
      title="Facility Manager verification"
      loginPath="/facility-portal/login"
      actions={{
        getContext: facilityGetMfaChallengeContext,
        verifyTotp: facilityVerifyMfaTotp,
        sendSms: facilitySendMfaLoginSms,
        verifySms: facilityVerifyMfaSms,
        cancel: facilityCancelMfaLogin,
      }}
    />
  );
}
