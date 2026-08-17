"use client";

import PortalHeaderBrand from "@/components/portal-header-brand";
import PortalHeaderAvatar from "@/components/portal-header-avatar";
import PortalNotificationBell from "./portal-notification-bell";
import PortalSignOutButton from "./dashboard/sign-out-button";

type TenantPortalTopBarProps = {
  userLabel: string;
  userPhotoUrl?: string | null;
  onMenuToggle: () => void;
  mobileNavOpen: boolean;
};

function MenuIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export default function TenantPortalTopBar({
  userLabel,
  userPhotoUrl = null,
  onMenuToggle,
  mobileNavOpen,
}: TenantPortalTopBarProps) {
  return (
    <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          onClick={onMenuToggle}
          aria-expanded={mobileNavOpen}
          aria-label={
            mobileNavOpen ? "Close navigation menu" : "Open navigation menu"
          }
          className="shrink-0 rounded-md p-2 text-[#0f2744] transition-colors hover:bg-slate-100 md:hidden"
        >
          <MenuIcon />
        </button>
        <PortalHeaderBrand variant="light" />
      </div>

      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        <PortalHeaderAvatar
          photoUrl={userPhotoUrl}
          fullName={userLabel}
          size="nav"
        />
        <span className="max-w-[5rem] truncate text-xs text-slate-700 sm:max-w-[10rem] sm:text-sm lg:max-w-[14rem]">
          {userLabel}
        </span>

        <PortalNotificationBell />
        <PortalSignOutButton variant="topbar" />
      </div>
    </header>
  );
}
