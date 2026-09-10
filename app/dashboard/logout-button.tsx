"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { purgeClientCacheBeforeSignOut } from "@/lib/client-cache/client-sign-out";
import { dismissPaystackInlineOverlays } from "@/app/dashboard/pos/paystack-inline";

type LogoutButtonProps = {
  className?: string;
};

export default function LogoutButton({ className = "" }: LogoutButtonProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);
    dismissPaystackInlineOverlays();

    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST" });
      if (!response.ok) {
        throw new Error("Sign out request failed.");
      }

      void purgeClientCacheBeforeSignOut().catch((error) => {
        console.error("[logout] client cache purge failed:", error);
      });

      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error("[logout] sign out failed:", error);
      setLoggingOut(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleLogout()}
      disabled={loggingOut}
      className={`rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {loggingOut ? "Logging out…" : "Log Out"}
    </button>
  );
}
