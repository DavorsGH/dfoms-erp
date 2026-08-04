"use client";

import { useEffect, useRef, useState } from "react";
import PortalHeaderAvatar, {
  LANDLORD_HEADER_PLACEHOLDER_LOGO,
} from "@/components/portal-header-avatar";
import LandlordPortalSignOutButton from "./dashboard/sign-out-button";
import LandlordNotificationBell from "./notification-bell";

type LandlordPortalTopBarProps = {
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

export default function LandlordPortalTopBar({
  userLabel,
  userPhotoUrl = null,
  onMenuToggle,
  mobileNavOpen,
}: LandlordPortalTopBarProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2 md:px-6">
      <button
        type="button"
        onClick={onMenuToggle}
        aria-expanded={mobileNavOpen}
        aria-label={
          mobileNavOpen ? "Close navigation menu" : "Open navigation menu"
        }
        className="rounded-md p-2 text-[#0f2744] transition-colors hover:bg-slate-100 md:hidden"
      >
        <MenuIcon />
      </button>

      <div className="hidden md:block" aria-hidden />

      <div className="flex items-center gap-2 md:gap-4">
        <LandlordNotificationBell />

        <div className="hidden items-center gap-3 md:flex">
          <PortalHeaderAvatar
            photoUrl={userPhotoUrl}
            fullName={userLabel}
            placeholderLogoUrl={LANDLORD_HEADER_PLACEHOLDER_LOGO}
          />
          <span className="text-sm text-slate-700">{userLabel}</span>
          <LandlordPortalSignOutButton variant="topbar" />
        </div>

        <div ref={menuRef} className="relative md:hidden">
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label="Open account menu"
            className="rounded-md p-0.5 transition-colors hover:bg-slate-100"
          >
            <PortalHeaderAvatar
              photoUrl={userPhotoUrl}
              fullName={userLabel}
              placeholderLogoUrl={LANDLORD_HEADER_PLACEHOLDER_LOGO}
            />
          </button>
          {open ? (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-2 w-48 rounded-md border border-slate-200 bg-white p-2 shadow-lg"
            >
              <p className="truncate px-2 py-1.5 text-xs text-slate-500">
                {userLabel}
              </p>
              <LandlordPortalSignOutButton variant="menu" />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
