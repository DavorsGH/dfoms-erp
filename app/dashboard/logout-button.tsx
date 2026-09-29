"use client";

import { useCallback } from "react";
import { usePlatformSignOut } from "@/hooks/use-platform-sign-out";
import { dismissPaystackInlineOverlays } from "@/app/dashboard/pos/paystack-inline";

type LogoutButtonProps = {
  className?: string;
};

export default function LogoutButton({ className = "" }: LogoutButtonProps) {
  const beforeSignOut = useCallback(() => {
    dismissPaystackInlineOverlays();
  }, []);

  const { signOut, loggingOut } = usePlatformSignOut({
    loginPath: "/login",
    beforeSignOut,
  });

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={loggingOut}
      className={`rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {loggingOut ? "Logging out…" : "Log Out"}
    </button>
  );
}
