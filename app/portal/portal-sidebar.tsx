"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DAVORS_PLATFORM_LOGO,
  DEFAULT_COMPANY_LEGAL_NAME,
  DEFAULT_WORKSPACE_LOGO,
  DEFAULT_WORKSPACE_NAME,
} from "@/utils/tenant-branding-types";
import {
  isTenantPortalPathActive,
  TENANT_PORTAL_NAV_ITEMS,
} from "./portal-nav-config";

type TenantPortalSidebarProps = {
  mobile?: boolean;
  onNavigate?: () => void;
  onClose?: () => void;
};

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

export default function TenantPortalSidebar({
  mobile = false,
  onNavigate,
  onClose,
}: TenantPortalSidebarProps) {
  const pathname = usePathname();

  function handleNavigate() {
    onNavigate?.();
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
              src={DEFAULT_WORKSPACE_LOGO}
              alt={`${DEFAULT_WORKSPACE_NAME} logo`}
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded-sm object-cover"
            />
            <div className="max-w-[10rem]">
              <p className="break-words text-base font-semibold leading-tight text-emerald-400">
                {DEFAULT_WORKSPACE_NAME}
              </p>
              <p className="mt-0.5 text-xs font-medium leading-tight text-white/90">
                Tenant Portal
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4 border-b border-white/10 px-5 py-8">
          <Image
            src={DEFAULT_WORKSPACE_LOGO}
            alt={`${DEFAULT_WORKSPACE_NAME} logo`}
            width={80}
            height={80}
            className="h-20 w-20 shrink-0 rounded-sm object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="break-words text-lg font-semibold leading-tight text-emerald-400">
              {DEFAULT_WORKSPACE_NAME}
            </p>
            <p className="mt-0.5 text-sm font-medium leading-tight text-white/90">
              Tenant Portal
            </p>
          </div>
        </div>
      )}

      <nav
        className={`flex flex-1 flex-col gap-1 overflow-y-auto py-4 ${
          mobile ? "px-2" : "px-3"
        }`}
      >
        {TENANT_PORTAL_NAV_ITEMS.map((item) => {
          const active = isTenantPortalPathActive(pathname, item.href);
          return (
            <Link
              key={item.id}
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
        })}
      </nav>

      <footer
        className={`shrink-0 border-t border-white/10 pt-4 pb-4 ${
          mobile ? "px-2" : "px-3"
        }`}
      >
        <p className="text-[10px] leading-snug text-white/45">
          © 2026 {DEFAULT_COMPANY_LEGAL_NAME}. All rights reserved.
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <Image
            src={DAVORS_PLATFORM_LOGO}
            alt="Davors"
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-sm object-cover"
          />
          <p className="text-[10px] leading-snug text-white/45">
            Powered by Davors Facilities
          </p>
        </div>
      </footer>
    </aside>
  );
}
