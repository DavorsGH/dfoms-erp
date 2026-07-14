"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import EmployeePhotoAvatar from "./employee-photo-avatar";
import LogoutButton from "./logout-button";

type UserAccountMenuProps = {
  userLabel: string;
  userPhotoUrl?: string | null;
  userFullName?: string | null;
};

export default function UserAccountMenu({
  userLabel,
  userPhotoUrl,
  userFullName,
}: UserAccountMenuProps) {
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
    <>
      <div className="hidden items-center gap-4 md:flex">
        <Link
          href="/dashboard/my-account"
          className="flex items-center gap-3 text-sm text-slate-700 transition-colors hover:text-[#0f2744] hover:underline"
        >
          <EmployeePhotoAvatar
            photoUrl={userPhotoUrl}
            fullName={userFullName ?? userLabel}
            size="header"
            square
          />
          <span>{userLabel}</span>
        </Link>
        <LogoutButton />
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
          <EmployeePhotoAvatar
            photoUrl={userPhotoUrl}
            fullName={userFullName ?? userLabel}
            size="header"
            square
          />
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-64 rounded-md border border-slate-200 bg-white py-2 shadow-lg"
          >
            <p className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-900">
              {userLabel}
            </p>
            <Link
              href="/dashboard/my-account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-[#0f2744]"
            >
              My Account
            </Link>
            <div className="px-4 py-2">
              <LogoutButton className="block w-full text-center" />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
