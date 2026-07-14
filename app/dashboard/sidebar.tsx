"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  canAccessReportCategory,
  getSidebarNavItems,
  type SidebarNavItem,
} from "@/utils/rbac-access";
import {
  isReportCategoryActive,
  isReportPath,
  REPORT_SIDEBAR_LINKS,
} from "./reports/reports-nav-config";

type SidebarProps = {
  userRole: AppRole | null;
  showLeaveApprovals?: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
  onClose?: () => void;
};

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }

  if (href === "/dashboard/reports") {
    return isReportPath(pathname);
  }

  return pathname.startsWith(href);
}

function CloseIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export default function Sidebar({
  userRole,
  showLeaveApprovals = false,
  mobile = false,
  onNavigate,
  onClose,
}: SidebarProps) {
  const pathname = usePathname();
  const [reportsOpen, setReportsOpen] = useState(false);
  const navItems = getSidebarNavItems(userRole);

  if (showLeaveApprovals) {
    navItems.push({
      label: "Leave Approvals",
      href: "/dashboard/leave-approvals",
    });
  }

  const reportLinks = REPORT_SIDEBAR_LINKS.filter((link) =>
    canAccessReportCategory(userRole, link.categoryId),
  );
  const reportsActive = isReportPath(pathname);
  const reportsExpanded = reportsActive || reportsOpen;

  useEffect(() => {
    if (!reportsActive) {
      setReportsOpen(false);
    }
  }, [pathname, reportsActive]);

  function handleReportsToggle() {
    if (reportsActive) {
      return;
    }

    setReportsOpen((current) => !current);
  }

  function handleNavigate() {
    onNavigate?.();
  }

  function renderNavItem(item: SidebarNavItem) {
    if (item.href === "/dashboard/reports") {
      return (
        <div key={item.href}>
          <button
            type="button"
            onClick={handleReportsToggle}
            aria-expanded={reportsExpanded}
            className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors ${
              reportsActive
                ? "bg-white/15 text-white"
                : "text-white/75 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span>{item.label}</span>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              width={20}
              height={20}
              className={`shrink-0 text-white/60 transition-transform duration-150 ${
                reportsExpanded ? "rotate-90" : ""
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          {reportsExpanded ? (
            <div className="ml-3 mt-1 space-y-0.5 border-l border-white/10 pl-2">
              {reportLinks.map((link) => {
                const categoryActive = isReportCategoryActive(
                  pathname,
                  link.categoryId,
                );

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={handleNavigate}
                    className={`block rounded-md px-2 py-1.5 text-xs font-medium leading-snug transition-colors ${
                      categoryActive
                        ? "bg-white/15 text-white"
                        : "text-white/70 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>
      );
    }

    const active = isActive(pathname, item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={handleNavigate}
        className={`block rounded-md px-3 py-2 text-sm font-medium leading-snug transition-colors ${
          active
            ? "bg-white/15 text-white"
            : "text-white/75 hover:bg-white/10 hover:text-white"
        }`}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <aside
      className={`flex flex-col bg-[#0f2744] text-white ${
        mobile
          ? "h-full w-[240px] max-w-[72vw] shadow-xl"
          : "min-h-screen w-56 shrink-0"
      }`}
    >
      {mobile ? (
        <div className="relative border-b border-white/10 px-4 py-5">
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation menu"
              className="absolute right-2 top-2 rounded-md p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <CloseIcon />
            </button>
          ) : null}
          <div className="flex flex-col items-center gap-2 text-center">
            <Image
              src="/logo.jpg"
              alt="Davors Facilities ERP logo"
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded-sm object-cover"
            />
            <div>
              <p className="text-base font-semibold leading-tight text-emerald-400">
                Davors Facilities
              </p>
              <p className="mt-0.5 text-xs font-medium leading-tight text-white/90">
                ERP System
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4 border-b border-white/10 px-5 py-8">
          <Image
            src="/logo.jpg"
            alt="Davors Facilities ERP logo"
            width={80}
            height={80}
            className="h-20 w-20 shrink-0 rounded-sm object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold leading-tight text-emerald-400">
              Davors Facilities
            </p>
            <p className="mt-0.5 text-sm font-medium leading-tight text-white/90">
              ERP System
            </p>
          </div>
        </div>
      )}

      <nav
        className={`flex flex-1 flex-col gap-1 overflow-y-auto py-4 ${
          mobile ? "px-2" : "px-3"
        }`}
      >
        {navItems.map((item) => renderNavItem(item))}
      </nav>
    </aside>
  );
}
