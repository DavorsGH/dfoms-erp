"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
import {
  DAVORS_PLATFORM_LOGO,
  DEFAULT_COMPANY_LEGAL_NAME,
  DEFAULT_WORKSPACE_LOGO,
  DEFAULT_WORKSPACE_NAME,
} from "@/utils/tenant-branding-types";
import {
  getLandlordPortalNavSections,
  isLandlordPortalPathActive,
  isLandlordPortalSectionActive,
  type LandlordPortalNavSection,
} from "./portal-nav-config";

type LandlordPortalSidebarProps = {
  landlordType: LandlordType | null;
  showNav: boolean;
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

function useSidebarExpandableSection(isActive: boolean) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const isExpanded = isActive || isOpen;

  useEffect(() => {
    if (!isActive) {
      setIsOpen(false);
    }
  }, [pathname, isActive]);

  function handleToggle() {
    if (isActive) {
      return;
    }
    setIsOpen((current) => !current);
  }

  return { isExpanded, handleToggle };
}

type ExpandableSectionProps = {
  label: string;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

function SidebarExpandableNavSection({
  label,
  isActive,
  isExpanded,
  onToggle,
  children,
}: ExpandableSectionProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors ${
          isActive
            ? "bg-white/15 text-white"
            : "text-white/75 hover:bg-white/10 hover:text-white"
        }`}
      >
        <span>{label}</span>
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          width={20}
          height={20}
          className={`shrink-0 text-white/60 transition-transform duration-150 ${
            isExpanded ? "rotate-90" : ""
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
      {isExpanded ? (
        <div className="ml-3 mt-1 space-y-0.5 border-l border-white/10 pl-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ExpandableNavItem({
  section,
  onNavigate,
}: {
  section: LandlordPortalNavSection;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sectionActive = isLandlordPortalSectionActive(pathname, section);
  const { isExpanded, handleToggle } = useSidebarExpandableSection(sectionActive);

  return (
    <SidebarExpandableNavSection
      label={section.label}
      isActive={sectionActive}
      isExpanded={isExpanded}
      onToggle={handleToggle}
    >
      {(section.links ?? []).map((link) => {
        const active = isLandlordPortalPathActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={`block rounded-md px-2 py-1.5 text-xs font-medium leading-snug transition-colors ${
              active
                ? "bg-white/15 text-white"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </SidebarExpandableNavSection>
  );
}

export default function LandlordPortalSidebar({
  landlordType,
  showNav,
  mobile = false,
  onNavigate,
  onClose,
}: LandlordPortalSidebarProps) {
  const pathname = usePathname();
  const sections = showNav
    ? getLandlordPortalNavSections(landlordType)
    : [
        {
          id: "dashboard",
          label: "Dashboard",
          href: "/landlord-portal/dashboard",
        } satisfies LandlordPortalNavSection,
      ];

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
                Landlord Portal
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
              Landlord Portal
            </p>
          </div>
        </div>
      )}

      <nav
        className={`flex flex-1 flex-col gap-1 overflow-y-auto py-4 ${
          mobile ? "px-2" : "px-3"
        }`}
      >
        {sections.map((section) => {
          if (section.links) {
            return (
              <ExpandableNavItem
                key={section.id}
                section={section}
                onNavigate={handleNavigate}
              />
            );
          }

          const href = section.href ?? "/landlord-portal/dashboard";
          const active = isLandlordPortalPathActive(pathname, href);
          return (
            <Link
              key={section.id}
              href={href}
              onClick={handleNavigate}
              className={`block rounded-md px-3 py-2 text-sm font-medium leading-snug transition-colors ${
                active
                  ? "bg-white/15 text-white"
                  : "text-white/75 hover:bg-white/10 hover:text-white"
              }`}
            >
              {section.label}
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
