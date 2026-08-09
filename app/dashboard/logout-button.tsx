"use client";

import { useRouter } from "next/navigation";
import { completePlatformSignOut } from "@/lib/auth/sign-out";

type LogoutButtonProps = {
  className?: string;
};

export default function LogoutButton({ className = "" }: LogoutButtonProps) {
  const router = useRouter();

  async function handleLogout() {
    await completePlatformSignOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className={`rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 ${className}`}
    >
      Log Out
    </button>
  );
}
