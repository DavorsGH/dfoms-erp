"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  DAVORS_PLATFORM_LOGO,
  type TenantBranding,
} from "@/utils/tenant-branding-types";
import {
  canAccessEmployeesSection,
  canAccessHrPayrollSection,
  canAccessReportCategory,
  getSidebarNavItems,
  type SidebarNavItem,
} from "@/utils/rbac-access";
import {
  HR_MANAGEMENT_SIDEBAR_LINKS,
  isHrManagementGroupActive,
  isHrManagementPath,
} from "./hr-payroll/hr-management-nav-config";
import {
  getAdministrationSidebarLinks,
  isAdministrationGroupActive,
  isAdministrationPath,
} from "./administration/administration-nav-config";
import {
  isReportCategoryActive,
  isReportPath,
  REPORT_SIDEBAR_LINKS,
} from "./reports/reports-nav-config";

type SidebarProps = {
  userRole: AppRole | null;
  showLeaveApprovals?: boolean;
  showPlatformSettings?: boolean;
  tenantBranding: TenantBranding;
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

  if (href === "/dashboard/hr-payroll") {
    return isHrManagementPath(pathname);
  }

  if (href === "/dashboard/administration") {
    return isAdministrationPath(pathname);
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

type SidebarExpandableNavSectionProps = {
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
}: SidebarExpandableNavSectionProps) {
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

export default function Sidebar({
  userRole,
  showLeaveApprovals = false,
  showPlatformSettings = false,
  tenantBranding,
  mobile = false,
  onNavigate,
  onClose,
}: SidebarProps) {
  const pathname = usePathname();
  const navItems = getSidebarNavItems(userRole);
  const administrationLinks = getAdministrationSidebarLinks(showPlatformSettings);
  const workspaceLogoUrl = tenantBranding.workspaceLogoUrl;
  const workspaceName = tenantBranding.workspaceName;
  const usesRemoteLogo = workspaceLogoUrl.startsWith("http");

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
  const {
    isExpanded: reportsExpanded,
    handleToggle: handleReportsToggle,
  } = useSidebarExpandableSection(reportsActive);
  const hrManagementLinks = HR_MANAGEMENT_SIDEBAR_LINKS.filter((link) => {
    if (link.groupId === "employees") {
      return canAccessEmployeesSection(userRole);
    }

    return canAccessHrPayrollSection(userRole);
  });
  const hrManagementActive = isHrManagementPath(pathname);
  const {
    isExpanded: hrManagementExpanded,
    handleToggle: handleHrManagementToggle,
  } = useSidebarExpandableSection(hrManagementActive);
  const administrationActive = isAdministrationPath(pathname);
  const {
    isExpanded: administrationExpanded,
    handleToggle: handleAdministrationToggle,
  } = useSidebarExpandableSection(administrationActive);

  function handleNavigate() {
    onNavigate?.();
  }

  function renderNavItem(item: SidebarNavItem) {
    if (item.href === "/dashboard/administration") {
      return (
        <div key={item.href}>
          <SidebarExpandableNavSection
            label={item.label}
            isActive={administrationActive}
            isExpanded={administrationExpanded}
            onToggle={handleAdministrationToggle}
          >
            {administrationLinks.map((link) => {
              const groupActive = isAdministrationGroupActive(
                pathname,
                link.groupId,
              );

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={handleNavigate}
                  className={`block rounded-md px-2 py-1.5 text-xs font-medium leading-snug transition-colors ${
                    groupActive
                      ? "bg-white/15 text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </SidebarExpandableNavSection>
        </div>
      );
    }

    if (item.href === "/dashboard/hr-payroll") {
      return (
        <div key={item.href}>
          <SidebarExpandableNavSection
            label={item.label}
            isActive={hrManagementActive}
            isExpanded={hrManagementExpanded}
            onToggle={handleHrManagementToggle}
          >
            {hrManagementLinks.map((link) => {
              const groupActive = isHrManagementGroupActive(
                pathname,
                link.groupId,
              );

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={handleNavigate}
                  className={`block rounded-md px-2 py-1.5 text-xs font-medium leading-snug transition-colors ${
                    groupActive
                      ? "bg-white/15 text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </SidebarExpandableNavSection>
        </div>
      );
    }

    if (item.href === "/dashboard/reports") {
      return (
        <div key={item.href}>
          <SidebarExpandableNavSection
            label={item.label}
            isActive={reportsActive}
            isExpanded={reportsExpanded}
            onToggle={handleReportsToggle}
          >
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
          </SidebarExpandableNavSection>
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
            {usesRemoteLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={workspaceLogoUrl}
                alt={`${workspaceName} logo`}
                className="h-14 w-14 shrink-0 rounded-sm object-cover"
              />
            ) : (
              <Image
                src={workspaceLogoUrl}
                alt={`${workspaceName} logo`}
                width={56}
                height={56}
                className="h-14 w-14 shrink-0 rounded-sm object-cover"
              />
            )}
            <div className="max-w-[10rem]">
              <p
                className="truncate text-base font-semibold leading-tight text-emerald-400"
                title={workspaceName}
              >
                {workspaceName}
              </p>
              <p className="mt-0.5 text-xs font-medium leading-tight text-white/90">
                ERP System
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4 border-b border-white/10 px-5 py-8">
          {usesRemoteLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={workspaceLogoUrl}
              alt={`${workspaceName} logo`}
              className="h-20 w-20 shrink-0 rounded-sm object-cover"
            />
          ) : (
            <Image
              src={workspaceLogoUrl}
              alt={`${workspaceName} logo`}
              width={80}
              height={80}
              className="h-20 w-20 shrink-0 rounded-sm object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-lg font-semibold leading-tight text-emerald-400"
              title={workspaceName}
            >
              {workspaceName}
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

      <footer
        className={`shrink-0 border-t border-white/10 pt-4 pb-4 ${
          mobile ? "px-2" : "px-3"
        }`}
      >
        <p className="text-[10px] leading-snug text-white/45">
          © 2026 Davors Facilities Management Services Ltd. All rights reserved.
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <Image
            src={DAVORS_PLATFORM_LOGO}
            alt="Davors"
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-sm object-cover"
          />
          <p className="text-[10px] leading-snug text-white/45">Powered by Davors Facilities</p>
        </div>
      </footer>
    </aside>
  );
}
