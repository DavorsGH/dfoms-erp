"use client";

import ForcedSetPasswordForm from "@/components/auth/forced-set-password-form";
import { FeedbackShell } from "@/components/feedback";

export default function StaffSetPasswordPage() {
  return (
    <FeedbackShell>
      <ForcedSetPasswordForm
        title="Set your new password"
        logoAlt="DavSuite"
        loginHref="/login"
      />
    </FeedbackShell>
  );
}
