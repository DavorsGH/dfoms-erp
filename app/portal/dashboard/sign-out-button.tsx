"use client";

import { useRouter } from "next/navigation";
import { completePlatformSignOut } from "@/lib/auth/sign-out";
import { purgeClientCacheBeforeSignOut } from "@/lib/client-cache/client-sign-out";

export default function PortalSignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await purgeClientCacheBeforeSignOut();
    await completePlatformSignOut();
    router.push("/portal/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="shrink-0 cursor-pointer rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15"
    >
      Sign out
    </button>
  );
}
