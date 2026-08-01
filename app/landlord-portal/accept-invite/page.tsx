import { Suspense } from "react";
import LandlordAcceptInvitePage from "./accept-invite-client";

export default function LandlordAcceptInviteRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0F2744] px-4">
          <p className="rounded-md border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600">
            Loading invite…
          </p>
        </div>
      }
    >
      <LandlordAcceptInvitePage />
    </Suspense>
  );
}
