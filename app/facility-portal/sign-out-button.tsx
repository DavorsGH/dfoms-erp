"use client";

import { useRouter } from "next/navigation";
import { completePlatformSignOut } from "@/lib/auth/sign-out";
import { purgeClientCacheBeforeSignOut } from "@/lib/client-cache/client-sign-out";

type FacilityPortalSignOutButtonProps = {
  variant?: "topbar" | "menu";
};

export default function FacilityPortalSignOutButton({
  variant = "topbar",
}: FacilityPortalSignOutButtonProps) {
  const router = useRouter();

  async function handleSignOut() {
    await purgeClientCacheBeforeSignOut();
    await completePlatformSignOut();
    router.push("/facility-portal/login");
    router.refresh();
  }

  const className =
    variant === "menu"
      ? "mt-1 w-full cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-left text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
      : "shrink-0 cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

  return (
    <button type="button" onClick={handleSignOut} className={className}>
      Log Out
    </button>
  );
}
