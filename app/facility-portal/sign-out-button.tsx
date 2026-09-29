"use client";

import { usePlatformSignOut } from "@/hooks/use-platform-sign-out";

type FacilityPortalSignOutButtonProps = {
  variant?: "topbar" | "menu";
};

export default function FacilityPortalSignOutButton({
  variant = "topbar",
}: FacilityPortalSignOutButtonProps) {
  const { signOut, loggingOut } = usePlatformSignOut({
    loginPath: "/facility-portal/login",
  });

  const className =
    variant === "menu"
      ? "mt-1 w-full cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-left text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      : "shrink-0 cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={loggingOut}
      className={className}
    >
      {loggingOut ? "Logging out…" : "Log Out"}
    </button>
  );
}
