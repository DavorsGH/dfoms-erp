import ForgotPasswordForm from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <ForgotPasswordForm
      resetCompletionPath="/reset-password"
      loginPath="/login"
    />
  );
}
