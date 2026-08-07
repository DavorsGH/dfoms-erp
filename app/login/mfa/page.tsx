"use client";

import { Suspense } from "react";
import MfaLoginChallengeForm from "@/components/mfa/mfa-login-challenge-form";
import {
  staffCancelMfaLogin,
  staffGetMfaChallengeContext,
  staffSendMfaLoginSms,
  staffVerifyMfaSms,
  staffVerifyMfaTotp,
} from "./actions";

function StaffMfaLoginInner() {
  return (
    <MfaLoginChallengeForm
      persona="staff"
      title="Two-factor verification"
      loginPath="/login"
      actions={{
        getContext: staffGetMfaChallengeContext,
        verifyTotp: staffVerifyMfaTotp,
        sendSms: staffSendMfaLoginSms,
        verifySms: staffVerifyMfaSms,
        cancel: staffCancelMfaLogin,
      }}
    />
  );
}

export default function StaffMfaLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0F2744] text-white">
          Loading…
        </div>
      }
    >
      <StaffMfaLoginInner />
    </Suspense>
  );
}
