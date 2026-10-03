"use client";

import ForgotPasswordForm from "@/components/auth/forgot-password-form";

export default function FacilityPortalForgotPasswordPage() {
  return (
    <ForgotPasswordForm
      title="Reset password"
      logoAlt="DavSuite Properties"
      resetCompletionPath="/facility-portal/reset-password"
      loginPath="/facility-portal/login"
    />
  );
}
