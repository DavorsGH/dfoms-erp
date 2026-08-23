"use client";

import ForgotPasswordForm from "@/components/auth/forgot-password-form";

export default function TenantPortalForgotPasswordPage() {
  return (
    <ForgotPasswordForm
      title="Tenant Portal — Reset Password"
      resetCompletionPath="/portal/reset-password"
      loginPath="/portal/login"
    />
  );
}
