"use client";

import ForcedSetPasswordForm from "@/components/auth/forced-set-password-form";

export default function LandlordPortalSetPasswordPage() {
  return (
    <ForcedSetPasswordForm
      title="Set your new password"
      logoAlt="DavSuite Properties"
      loginHref="/landlord-portal/login"
    />
  );
}
