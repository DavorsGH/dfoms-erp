"use client";

import UserAccountMenu from "./user-account-menu";

type TopBarProps = {
  userLabel: string;
  userPhotoUrl?: string | null;
  userFullName?: string | null;
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

export default function TopBar({
  userLabel,
  userPhotoUrl,
  userFullName,
  onMenuToggle,
  mobileNavOpen,
}: TopBarProps) {
  return (
    <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2 md:px-6">
      <button
        type="button"
        onClick={onMenuToggle}
        aria-expanded={mobileNavOpen}
        aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
        className="rounded-md p-2 text-[#0f2744] transition-colors hover:bg-slate-100 md:hidden"
      >
        <MenuIcon />
      </button>

      <div className="hidden md:block" aria-hidden />

      <UserAccountMenu
        userLabel={userLabel}
        userPhotoUrl={userPhotoUrl}
        userFullName={userFullName}
      />
    </header>
  );
}
