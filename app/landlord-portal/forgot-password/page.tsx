"use client";

import ForgotPasswordForm from "@/components/auth/forgot-password-form";

export default function LandlordPortalForgotPasswordPage() {
  return (
    <ForgotPasswordForm
      title="Landlord Portal — Reset Password"
      resetCompletionPath="/landlord-portal/reset-password"
      loginPath="/landlord-portal/login"
    />
  );
}
