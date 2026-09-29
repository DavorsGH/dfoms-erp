"use client";

import { usePlatformSignOut } from "@/hooks/use-platform-sign-out";

type PortalSignOutButtonProps = {
  variant?: "header" | "topbar";
};

export default function PortalSignOutButton({
  variant = "header",
}: PortalSignOutButtonProps) {
  const { signOut, loggingOut } = usePlatformSignOut({
    loginPath: "/portal/login",
  });

  const className =
    variant === "topbar"
      ? "shrink-0 cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      : "shrink-0 cursor-pointer rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60";

  const idleLabel = variant === "topbar" ? "Log Out" : "Sign out";

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={loggingOut}
      className={className}
    >
      {loggingOut ? "Logging out…" : idleLabel}
    </button>
  );
}
