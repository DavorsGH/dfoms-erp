"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { zClass } from "@/utils/z-index";
import EmployeePhotoAvatar from "./employee-photo-avatar";
import LogoutButton from "./logout-button";

type UserAccountMenuProps = {
  userLabel: string;
  userPhotoUrl?: string | null;
  userFullName?: string | null;
  linkedEmployeeId?: string | null;
};

export default function UserAccountMenu({
  userLabel,
  userPhotoUrl,
  userFullName,
  linkedEmployeeId = null,
}: UserAccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function positionMenu() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setMenuStyle({
        position: "fixed",
        top: rect.bottom + 8,
        right: Math.max(8, window.innerWidth - rect.right),
        width: "16rem",
      });
    }

    positionMenu();

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("click", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("click", handleClickOutside);
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
            employeeId={linkedEmployeeId}
            fullName={userFullName ?? userLabel}
            size="header"
          />
          <span>{userLabel}</span>
        </Link>
        <LogoutButton />
      </div>

      <div ref={triggerRef} className="relative md:hidden">
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
            employeeId={linkedEmployeeId}
            fullName={userFullName ?? userLabel}
            size="header"
          />
        </button>

        {open && typeof document !== "undefined"
          ? createPortal(
              <div
                ref={menuRef}
                role="menu"
                style={menuStyle}
                className={`${zClass.dropdown} rounded-md border border-slate-200 bg-white py-2 shadow-lg`}
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
              </div>,
              document.body,
            )
          : null}
      </div>
    </>
  );
}
