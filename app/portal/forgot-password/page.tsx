"use client";

import ForgotPasswordForm from "@/components/auth/forgot-password-form";

export default function TenantPortalForgotPasswordPage() {
  return (
    <ForgotPasswordForm
      title="Reset password"
      logoAlt="DavSuite Properties"
      resetCompletionPath="/portal/reset-password"
      loginPath="/portal/login"
    />
  );
}
