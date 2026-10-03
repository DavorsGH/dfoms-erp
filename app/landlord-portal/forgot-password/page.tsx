"use client";

import ForgotPasswordForm from "@/components/auth/forgot-password-form";

export default function LandlordPortalForgotPasswordPage() {
  return (
    <ForgotPasswordForm
      title="Reset password"
      logoAlt="DavSuite Properties"
      resetCompletionPath="/landlord-portal/reset-password"
      loginPath="/landlord-portal/login"
    />
  );
}
