import { Suspense } from "react";
import StaffAcceptInviteClient from "./accept-invite-client";

export default function StaffAcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0F2744] text-white">
          Loading…
        </div>
      }
    >
      <StaffAcceptInviteClient />
    </Suspense>
  );
}
