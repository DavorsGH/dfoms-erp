"use client";

import { usePlatformSignOut } from "@/hooks/use-platform-sign-out";

type LandlordPortalSignOutButtonProps = {
  variant?: "header" | "topbar" | "menu";
};

export default function LandlordPortalSignOutButton({
  variant = "header",
}: LandlordPortalSignOutButtonProps) {
  const { signOut, loggingOut } = usePlatformSignOut({
    loginPath: "/landlord-portal/login",
  });

  const className =
    variant === "topbar"
      ? "shrink-0 cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      : variant === "menu"
        ? "mt-1 w-full cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-left text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        : "shrink-0 cursor-pointer rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60";

  const label =
    variant === "topbar" || variant === "menu"
      ? loggingOut
        ? "Logging out…"
        : "Log Out"
      : loggingOut
        ? "Logging out…"
        : "Sign out";

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={loggingOut}
      className={className}
    >
      {label}
    </button>
  );
}
