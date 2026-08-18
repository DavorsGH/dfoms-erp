"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getActiveAdministrationGroup,
  getMonitoringSupportNavItems,
  getPlatformAdministrationGroups,
  isPlatformAdministrationPath,
  MONITORING_SUPPORT_GROUP_ID,
  type AdministrationNavGroup,
} from "./administration-nav-config";

const tabClassName = (active: boolean) =>
  `shrink-0 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
    active
      ? "bg-[#0f2744] text-white"
      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
  }`;

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
  const showPlatformTabGroups =
    isPlatformAdministrationPath(pathname) && showPlatformMonitoringTabs;

  if (showPlatformTabGroups) {
    const groups = getPlatformAdministrationGroups().map((group) =>
      withFilteredItems(group, showPlatformMonitoringTabs),
    );

    return (
      <nav className="mb-6 space-y-4 border-b border-slate-200 pb-4">
        {groups.map((group) => (
          <AdministrationTabGroup
            key={group.id}
            group={group}
            pathname={pathname}
          />
        ))}
      </nav>
    );
  }

  if (activeGroup.id === MONITORING_SUPPORT_GROUP_ID) {
    const group = withFilteredItems(activeGroup, showPlatformMonitoringTabs);

    return (
      <nav className="mb-6 border-b border-slate-200 pb-4">
        <AdministrationTabGroup group={group} pathname={pathname} />
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
