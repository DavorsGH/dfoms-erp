"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getActiveAdministrationGroup,
  getMonitoringSupportNavItems,
  getPlatformAdministrationGroups,
  isPlatformAdministrationPath,
  MONITORING_SUPPORT_GROUP_ID,
  PLATFORM_SETTINGS_GROUP_ID,
  type AdministrationNavGroup,
} from "./administration-nav-config";

const tabClassName = (active: boolean) =>
  `shrink-0 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
    active
      ? "bg-[#0f2744] text-white"
      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
  }`;

const PLATFORM_ADMIN_GROUP_IDS = new Set([
  PLATFORM_SETTINGS_GROUP_ID,
  MONITORING_SUPPORT_GROUP_ID,
]);

function withFilteredItems(
  group: AdministrationNavGroup,
  showPlatformMonitoringTabs: boolean,
): AdministrationNavGroup {
  if (group.id !== MONITORING_SUPPORT_GROUP_ID) {
    return group;
  }

  return {
    ...group,
    items: getMonitoringSupportNavItems(showPlatformMonitoringTabs),
  };
}

function AdministrationTabGroup({
  group,
  pathname,
}: {
  group: AdministrationNavGroup;
  pathname: string;
}) {
  if (group.items.length === 0) {
    return null;
  }

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {group.label}
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {group.items.map((item) => {
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              scroll
              className={tabClassName(active)}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

type AdministrationNavProps = {
  showPlatformMonitoringTabs: boolean;
};

export default function AdministrationNav({
  showPlatformMonitoringTabs,
}: AdministrationNavProps) {
  const pathname = usePathname();
  const activeGroup = getActiveAdministrationGroup(pathname);
  const onPlatformAdminPage = isPlatformAdministrationPath(pathname);

  // Davors platform admins: Platform Settings + Monitoring & Support tab rows
  // are always available on every Administration page (page-level grouping only;
  // these groups are intentionally not duplicated in the sidebar sub-nav).
  if (showPlatformMonitoringTabs) {
    const platformGroups = getPlatformAdministrationGroups().map((group) =>
      withFilteredItems(group, true),
    );
    const showSectionTabs =
      !onPlatformAdminPage && !PLATFORM_ADMIN_GROUP_IDS.has(activeGroup.id);

    return (
      <nav className="mb-6 space-y-4 border-b border-slate-200 pb-4">
        {platformGroups.map((group) => (
          <AdministrationTabGroup
            key={group.id}
            group={group}
            pathname={pathname}
          />
        ))}
        {showSectionTabs ? (
          <AdministrationTabGroup group={activeGroup} pathname={pathname} />
        ) : null}
      </nav>
    );
  }

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {activeGroup.items.map((item) => {
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              scroll
              className={tabClassName(active)}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
