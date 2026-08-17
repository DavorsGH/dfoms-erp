"use client";

import { useRouter } from "next/navigation";
import { completePlatformSignOut } from "@/lib/auth/sign-out";
import { purgeClientCacheBeforeSignOut } from "@/lib/client-cache/client-sign-out";

type PortalSignOutButtonProps = {
  variant?: "header" | "topbar";
};

export default function PortalSignOutButton({
  variant = "header",
}: PortalSignOutButtonProps) {
  const router = useRouter();

  async function handleSignOut() {
    await purgeClientCacheBeforeSignOut();
    await completePlatformSignOut();
    router.push("/portal/login");
    router.refresh();
  }

  const className =
    variant === "topbar"
      ? "shrink-0 cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
      : "shrink-0 cursor-pointer rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15";

  return (
    <button type="button" onClick={handleSignOut} className={className}>
      {variant === "topbar" ? "Log Out" : "Sign out"}
    </button>
  );
}
