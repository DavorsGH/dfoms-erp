"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

type LandlordPortalSignOutButtonProps = {
  variant?: "header" | "topbar" | "menu";
};

export default function LandlordPortalSignOutButton({
  variant = "header",
}: LandlordPortalSignOutButtonProps) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/landlord-portal/login");
    router.refresh();
  }

  const className =
    variant === "topbar"
      ? "shrink-0 cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
      : variant === "menu"
        ? "mt-1 w-full cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-left text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
        : "shrink-0 cursor-pointer rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15";

  return (
    <button type="button" onClick={handleSignOut} className={className}>
      {variant === "topbar" || variant === "menu" ? "Log Out" : "Sign out"}
    </button>
  );
}
