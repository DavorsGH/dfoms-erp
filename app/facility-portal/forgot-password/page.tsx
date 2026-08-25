"use client";

import ForgotPasswordForm from "@/components/auth/forgot-password-form";

export default function FacilityPortalForgotPasswordPage() {
  return (
    <ForgotPasswordForm
      title="Facility Manager Portal — Reset Password"
      resetCompletionPath="/facility-portal/reset-password"
      loginPath="/facility-portal/login"
    />
  );
}
