import { Suspense } from "react";
import AcceptInvitePage from "./accept-invite-client";

export default function AcceptInviteRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0F2744] px-4">
          <p className="rounded-lg bg-white px-6 py-4 text-sm text-zinc-600">
            Loading invite…
          </p>
        </div>
      }
    >
      <AcceptInvitePage />
    </Suspense>
  );
}
