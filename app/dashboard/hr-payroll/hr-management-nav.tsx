"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ModuleNavTabStrip,
  moduleNavActiveTabProps,
} from "@/app/dashboard/module-nav-tab-strip";
import { getActiveHrManagementGroup } from "./hr-management-nav-config";

const tabClassName = (active: boolean) =>
  `shrink-0 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
    active
      ? "bg-[#0f2744] text-white"
      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
  }`;

export default function HrManagementNav() {
  const pathname = usePathname();
  const activeGroup = getActiveHrManagementGroup(pathname);

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <ModuleNavTabStrip scrollKey={pathname}>
        {activeGroup.items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href.startsWith(
              "/dashboard/hr-payroll/employee-announcements",
            ) &&
              pathname.startsWith(
                "/dashboard/hr-payroll/employee-announcements",
              ));

          return (
            <Link
              key={item.href}
              href={item.href}
              scroll
              {...moduleNavActiveTabProps(active)}
              className={tabClassName(active)}
            >
              {item.label}
            </Link>
          );
        })}
      </ModuleNavTabStrip>
    </nav>
  );
}
