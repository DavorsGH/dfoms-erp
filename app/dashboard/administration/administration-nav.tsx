"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getActiveAdministrationGroup,
  LEAVE_APPROVALS_HREF,
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

const SIDEBAR_NAV_GROUP_IDS = new Set([
  PLATFORM_SETTINGS_GROUP_ID,
  MONITORING_SUPPORT_GROUP_ID,
]);

function AdministrationTabGroup({
  group,
  pathname,
  showGroupLabel = true,
}: {
  group: AdministrationNavGroup;
  pathname: string;
  showGroupLabel?: boolean;
}) {
  if (group.items.length === 0) {
    return null;
  }

  return (
    <div>
      {showGroupLabel ? (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {group.label}
        </p>
      ) : null}
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

export default function AdministrationNav() {
  const pathname = usePathname();

  if (pathname.startsWith(LEAVE_APPROVALS_HREF)) {
    return null;
  }

  const activeGroup = getActiveAdministrationGroup(pathname);

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <AdministrationTabGroup
        group={activeGroup}
        pathname={pathname}
        showGroupLabel={!SIDEBAR_NAV_GROUP_IDS.has(activeGroup.id)}
      />
    </nav>
  );
}
