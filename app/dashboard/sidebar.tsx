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
import WorkspaceLogo from "./workspace-logo";
import { useBusinessUnitView } from "./business-unit-view-context";
import {
  canAccessEmployeesSection,
  canAccessHrPayrollSection,
  canAccessReportCategory,
  getSidebarNavItems,
  withApproverInboxNav,
  type SidebarNavItem,
} from "@/utils/rbac-access";
import {
  getHrManagementSidebarLinks,
  isHrManagementGroupActive,
  isHrManagementPath,
  SELF_SERVICE_APPROVALS_HREF,
} from "./hr-payroll/hr-management-nav-config";
import ApprovalsCountBadge from "./self-service/approvals/approvals-count-badge";
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
import {
  INVENTORY_SIDEBAR_LINKS,
  isInventoryGroupActive,
  isInventoryPath,
} from "./inventory/inventory-nav-config";
import Tooltip from "@/components/ui/tooltip";
import { SidebarOutlineIcon, sidebarIconName } from "./sidebar-icons";

type SidebarProps = {
  userRole: AppRole | null;
  linkedEmployeeId?: string | null;
  showLeaveApprovals?: boolean;
  showAttendanceApprovals?: boolean;
  showPlatformSettings?: boolean;
  showRealEstate?: boolean;
  tenantBranding: TenantBranding;
  mobile?: boolean;
  onNavigate?: () => void;
  onClose?: () => void;
};

/** Sidebar has ~87 routes; default Link prefetch triggers middleware on each. */
const SIDEBAR_LINK_PREFETCH = false;

type SidebarLinkProps = {
  href: string;
  className: string;
  onClick?: () => void;
  children: React.ReactNode;
};

function SidebarLink({ href, className, onClick, children }: SidebarLinkProps) {
  return (
    <Link
      href={href}
      prefetch={SIDEBAR_LINK_PREFETCH}
      onClick={onClick}
      className={className}
    >
      {children}
    </Link>
  );
}

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

  if (href === "/dashboard/directors") {
    return pathname.startsWith("/dashboard/directors");
  }

  if (href === "/dashboard/devices") {
    return pathname.startsWith("/dashboard/devices");
  }

  if (href === "/dashboard/administration") {
    return isAdministrationPath(pathname);
  }

  if (href === "/dashboard/inventory") {
    return isInventoryPath(pathname);
  }

  if (href === "/dashboard/crm") {
    // POS is a tab within Sales & CRM even though its route lives at
    // /dashboard/pos.
    return (
      pathname.startsWith("/dashboard/crm") ||
      pathname.startsWith("/dashboard/sales-crm") ||
      pathname.startsWith("/dashboard/pos")
    );
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

  useEffect(() => {
    if (isActive) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [pathname, isActive]);

  function handleToggle() {
    setIsOpen((current) => !current);
  }

  return { isExpanded: isOpen, handleToggle };
}

type SidebarExpandableNavSectionProps = {
  label: React.ReactNode;
  labelText?: string;
  icon: React.ReactNode;
  collapsed: boolean;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

function SidebarExpandableNavSection({
  label,
  labelText,
  icon,
  collapsed,
  isActive,
  isExpanded,
  onToggle,
  children,
}: SidebarExpandableNavSectionProps) {
  const accessibleLabel =
    labelText ?? (typeof label === "string" ? label : undefined);
  const button = (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={collapsed ? false : isExpanded}
      aria-label={collapsed ? accessibleLabel : undefined}
      title={collapsed ? accessibleLabel : undefined}
      className={`flex min-h-10 w-full items-center gap-2 rounded-md py-2.5 text-left text-sm font-medium transition-colors ${
        collapsed ? "justify-center px-2" : "justify-between px-3"
      } ${
        isActive
          ? "bg-white/15 text-white"
          : "text-white/75 hover:bg-white/10 hover:text-white"
      }`}
    >
      <span
        className={`flex min-w-0 items-center ${
          collapsed ? "justify-center" : "gap-2.5"
        }`}
      >
        {icon}
        <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
      </span>
      {collapsed ? null : (
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
      )}
    </button>
  );

  return (
    <div>
      {collapsed ? (
        <Tooltip content={label} side="right" className="w-full">
          {button}
        </Tooltip>
      ) : (
        button
      )}
      {isExpanded && !collapsed ? (
        <div className="ml-3 mt-1 space-y-0.5 border-l border-white/10 pl-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export default function Sidebar({
  userRole,
  linkedEmployeeId = null,
  showLeaveApprovals = false,
  showAttendanceApprovals = false,
  showPlatformSettings = false,
  showRealEstate = false,
  tenantBranding,
  mobile = false,
  onNavigate,
  onClose,
}: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const iconOnly = collapsed && !mobile;
  const navItems = withApproverInboxNav(
    getSidebarNavItems(userRole, linkedEmployeeId),
    { showLeaveApprovals, showAttendanceApprovals },
  );
  const administrationLinks = getAdministrationSidebarLinks({
    isDavorsPlatformSuperAdmin:
      showPlatformSettings && userRole === "super_admin",
    audience: userRole === "director" ? "director" : "super_admin",
  });
  const {
    viewAllBusinessUnits,
    activeBusinessUnitId,
    units: businessUnits,
  } = useBusinessUnitView();

  const activeUnit =
    !viewAllBusinessUnits && activeBusinessUnitId
      ? (businessUnits.find((unit) => unit.id === activeBusinessUnitId) ?? null)
      : null;

  const workspaceName = activeUnit?.name?.trim() || tenantBranding.workspaceName;
  const workspaceLogoUrl =
    activeUnit?.logoUrl?.trim() || tenantBranding.workspaceLogoUrl;

  if (showRealEstate) {
    const operationsIndex = navItems.findIndex(
      (item) => item.href === "/dashboard/operations",
    );
    const hrIndex = navItems.findIndex(
      (item) => item.href === "/dashboard/hr-payroll",
    );
    const realEstateItem = {
      label: "Real Estate",
      href: "/dashboard/real-estate",
    };
    // Keep Real Estate after HR Management (before Self-Service when present).
    const insertAt =
      hrIndex >= 0
        ? hrIndex + 1
        : operationsIndex >= 0
          ? operationsIndex + 1
          : navItems.length;
    navItems.splice(insertAt, 0, realEstateItem);
  }

  const reportLinks = REPORT_SIDEBAR_LINKS.filter((link) => {
    // Real Estate reports use the same Davors-platform gate as RE staff ops.
    if (link.categoryId === "real-estate" && !showRealEstate) {
      return false;
    }
    return canAccessReportCategory(userRole, link.categoryId, { showRealEstate });
  });
  const reportsActive = isReportPath(pathname);
  const {
    isExpanded: reportsExpanded,
    handleToggle: handleReportsToggle,
  } = useSidebarExpandableSection(reportsActive);
  const hrManagementLinks = getHrManagementSidebarLinks().filter((link) => {
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
  const showApprovalsNav = showLeaveApprovals || showAttendanceApprovals;
  const hasSelfServiceHome = Boolean(linkedEmployeeId?.trim());
  const selfServiceApprovalsActive = pathname.startsWith(
    SELF_SERVICE_APPROVALS_HREF,
  );
  const selfServiceActive =
    pathname.startsWith("/dashboard/self-service") || selfServiceApprovalsActive;
  const {
    isExpanded: selfServiceExpanded,
    handleToggle: handleSelfServiceToggle,
  } = useSidebarExpandableSection(selfServiceActive && showApprovalsNav);
  const administrationActive = isAdministrationPath(pathname);
  const {
    isExpanded: administrationExpanded,
    handleToggle: handleAdministrationToggle,
  } = useSidebarExpandableSection(administrationActive);
  const inventoryActive = isInventoryPath(pathname);
  const {
    isExpanded: inventoryExpanded,
    handleToggle: handleInventoryToggle,
  } = useSidebarExpandableSection(inventoryActive);

  function handleNavigate() {
    onNavigate?.();
  }

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("dfoms-sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  }

  useEffect(() => {
    if (mobile) {
      return;
    }
    setCollapsed(window.localStorage.getItem("dfoms-sidebar-collapsed") === "1");
  }, [mobile]);

  function openSection(isExpanded: boolean, toggle: () => void) {
    if (iconOnly) {
      setCollapsed(false);
      window.localStorage.setItem("dfoms-sidebar-collapsed", "0");
      if (!isExpanded) {
        toggle();
      }
      return;
    }
    toggle();
  }

  function renderNavItem(item: SidebarNavItem) {
    if (item.href === "/dashboard/administration") {
      return (
        <div key={item.href}>
          <SidebarExpandableNavSection
            label={item.label}
            icon={<SidebarOutlineIcon name={sidebarIconName(item.href)} />}
            collapsed={iconOnly}
            isActive={administrationActive}
            isExpanded={administrationExpanded}
            onToggle={() =>
              openSection(administrationExpanded, handleAdministrationToggle)
            }
          >
            {administrationLinks.map((link) => {
              const groupActive = isAdministrationGroupActive(
                pathname,
                link.groupId,
              );

              return (
                <SidebarLink
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
                </SidebarLink>
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
            icon={<SidebarOutlineIcon name={sidebarIconName(item.href)} />}
            collapsed={iconOnly}
            isActive={hrManagementActive}
            isExpanded={hrManagementExpanded}
            onToggle={() =>
              openSection(hrManagementExpanded, handleHrManagementToggle)
            }
          >
            {hrManagementLinks.map((link) => {
              const groupActive = isHrManagementGroupActive(
                pathname,
                link.groupId,
              );

              return (
                <SidebarLink
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
                </SidebarLink>
              );
            })}
          </SidebarExpandableNavSection>
        </div>
      );
    }

    if (item.href === "/dashboard/self-service" && showApprovalsNav) {
      const selfServiceChildren: { label: string; href: string }[] = [];
      if (hasSelfServiceHome) {
        selfServiceChildren.push({
          label: "My Self-Service",
          href: "/dashboard/self-service",
        });
      }
      selfServiceChildren.push({
        label: "Approvals",
        href: SELF_SERVICE_APPROVALS_HREF,
      });

      return (
        <div key={item.href}>
          <SidebarExpandableNavSection
            label={
              <span className="inline-flex items-center gap-1">
                {item.label}
                <ApprovalsCountBadge
                  showLeave={showLeaveApprovals}
                  showAttendance={showAttendanceApprovals}
                />
              </span>
            }
            labelText={item.label}
            icon={<SidebarOutlineIcon name={sidebarIconName(item.href)} />}
            collapsed={iconOnly}
            isActive={selfServiceActive}
            isExpanded={selfServiceExpanded}
            onToggle={() =>
              openSection(selfServiceExpanded, handleSelfServiceToggle)
            }
          >
            {selfServiceChildren.map((link) => {
              const childActive =
                link.href === SELF_SERVICE_APPROVALS_HREF
                  ? selfServiceApprovalsActive
                  : pathname.startsWith("/dashboard/self-service") &&
                    !selfServiceApprovalsActive;

              return (
                <SidebarLink
                  key={link.href}
                  href={link.href}
                  onClick={handleNavigate}
                  className={`block rounded-md px-2 py-1.5 text-xs font-medium leading-snug transition-colors ${
                    childActive
                      ? "bg-white/15 text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {link.label}
                    {link.href === SELF_SERVICE_APPROVALS_HREF ? (
                      <ApprovalsCountBadge
                        showLeave={showLeaveApprovals}
                        showAttendance={showAttendanceApprovals}
                      />
                    ) : null}
                  </span>
                </SidebarLink>
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
            icon={<SidebarOutlineIcon name={sidebarIconName(item.href)} />}
            collapsed={iconOnly}
            isActive={reportsActive}
            isExpanded={reportsExpanded}
            onToggle={() => openSection(reportsExpanded, handleReportsToggle)}
          >
            {reportLinks.map((link) => {
              const categoryActive = isReportCategoryActive(
                pathname,
                link.categoryId,
              );

              return (
                <SidebarLink
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
                </SidebarLink>
              );
            })}
          </SidebarExpandableNavSection>
        </div>
      );
    }

    if (item.href === "/dashboard/inventory") {
      return (
        <div key={item.href}>
          <SidebarExpandableNavSection
            label={item.label}
            icon={<SidebarOutlineIcon name={sidebarIconName(item.href)} />}
            collapsed={iconOnly}
            isActive={inventoryActive}
            isExpanded={inventoryExpanded}
            onToggle={() =>
              openSection(inventoryExpanded, handleInventoryToggle)
            }
          >
            {INVENTORY_SIDEBAR_LINKS.map((link) => {
              const groupActive = isInventoryGroupActive(
                pathname,
                link.groupId,
              );

              return (
                <SidebarLink
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
                </SidebarLink>
              );
            })}
          </SidebarExpandableNavSection>
        </div>
      );
    }

    const active = isActive(pathname, item.href);
    const link = (
      <SidebarLink
        href={item.href}
        onClick={handleNavigate}
        className={`flex min-h-10 w-full items-center rounded-md py-2 text-sm font-medium leading-snug transition-colors ${
          iconOnly ? "justify-center px-2" : "gap-2.5 px-3"
        } ${
          active
            ? "bg-white/15 text-white"
            : "text-white/75 hover:bg-white/10 hover:text-white"
        }`}
      >
        <SidebarOutlineIcon name={sidebarIconName(item.href)} />
        <span className={iconOnly ? "sr-only" : "truncate"}>{item.label}</span>
      </SidebarLink>
    );

    if (!iconOnly) {
      return <div key={item.href}>{link}</div>;
    }

    return (
      <Tooltip key={item.href} content={item.label} side="right" className="w-full">
        {link}
      </Tooltip>
    );
  }

  return (
    <aside
      className={`flex flex-col bg-[#0f2744] text-white ${
        mobile
          ? "h-full w-[240px] max-w-[72vw] shadow-xl"
          : iconOnly
            ? "min-h-screen w-16 shrink-0"
            : "min-h-screen w-56 shrink-0"
      }`}
    >
      <div
        className={`relative flex items-center gap-2.5 border-b border-white/10 ${
          iconOnly ? "flex-col px-2 py-4" : mobile ? "px-3 py-4" : "px-3 py-5"
        }`}
      >
        {mobile && onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="absolute right-1.5 top-1.5 rounded-md p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <CloseIcon />
          </button>
        ) : null}
        <WorkspaceLogo
          workspaceLogoUrl={workspaceLogoUrl}
          name={workspaceName}
          size="xs"
          rounded="md"
          className="!h-10 !w-10 !rounded-[6px] object-cover"
        />
        <div
          className={
            iconOnly
              ? "sr-only"
              : `min-w-0 flex-1 ${mobile && onClose ? "pr-8" : ""}`
          }
        >
          <p
            className="truncate text-sm font-semibold leading-tight text-emerald-400"
            title={workspaceName}
          >
            {workspaceName}
          </p>
          <p className="mt-0.5 text-xs font-medium leading-tight text-white/90">
            DavSuite
          </p>
        </div>
        {mobile ? null : (
          <Tooltip
            content={iconOnly ? "Expand sidebar" : "Collapse sidebar"}
            side="right"
          >
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={iconOnly ? "Expand sidebar" : "Collapse sidebar"}
              className="rounded-md p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <SidebarOutlineIcon name={iconOnly ? "expand" : "collapse"} />
            </button>
          </Tooltip>
        )}
      </div>

      <nav
        className={`flex flex-1 flex-col gap-1 overflow-y-auto py-4 ${
          iconOnly ? "px-1.5" : mobile ? "px-2" : "px-3"
        }`}
      >
        {navItems.map((item) => renderNavItem(item))}
      </nav>

      <footer
        className={`shrink-0 border-t border-white/10 pt-4 pb-4 ${
          iconOnly ? "px-1.5" : mobile ? "px-2" : "px-3"
        }`}
      >
        {iconOnly ? null : (
          <p className="text-[10px] leading-snug text-white/45">
            © 2026 Davors Technologies Ltd. All rights reserved.
          </p>
        )}
        <div
          className={`flex items-center gap-1.5 ${iconOnly ? "justify-center" : "mt-2"}`}
        >
          <Image
            src={DAVORS_PLATFORM_LOGO}
            alt="DavSuite"
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-sm object-cover"
          />
          {iconOnly ? null : (
            <p className="text-[10px] leading-snug text-white/45">
              Powered by Davors Technologies
            </p>
          )}
        </div>
      </footer>
    </aside>
  );
}
