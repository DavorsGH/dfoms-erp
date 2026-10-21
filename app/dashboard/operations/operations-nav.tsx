"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ModuleNavTabStrip,
  moduleNavActiveTabProps,
} from "@/app/dashboard/module-nav-tab-strip";

const navItems = [
  { label: "Duty Roster", href: "/dashboard/operations/duty-roster" },
  { label: "Roster History", href: "/dashboard/operations/roster-history" },
  { label: "Consumables", href: "/dashboard/operations/consumables" },
  { label: "Work Orders", href: "/dashboard/operations/work-orders" },
  {
    label: "Inspection Summary",
    href: "/dashboard/operations/inspection-summary",
  },
  {
    label: "Failed Inspections",
    href: "/dashboard/operations/failed-inspections",
  },
  {
    label: "Corrective Actions",
    href: "/dashboard/operations/corrective-actions",
  },
  {
    label: "Complaint Register",
    href: "/dashboard/operations/complaint-register",
  },
  {
    label: "Incident Register",
    href: "/dashboard/operations/incident-register",
  },
] as const;

type OperationsNavProps = {
  showCustomerList?: boolean;
  showOutageAttendance?: boolean;
};

export default function OperationsNav({
  showCustomerList = false,
  showOutageAttendance = false,
}: OperationsNavProps) {
  const pathname = usePathname();
  const withOutage = showOutageAttendance
    ? [
        ...navItems,
        {
          label: "Outage attendance",
          href: "/dashboard/operations/outage-attendance",
        },
      ]
    : navItems;
  const visibleItems = showCustomerList
    ? [
        { label: "Customer List", href: "/dashboard/crm/customers" },
        ...withOutage,
      ]
    : withOutage;

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <ModuleNavTabStrip
        scrollKey={`${pathname}:${showCustomerList ? "customers" : "ops"}`}
      >
        {visibleItems.map((item) => {
          const active =
            item.href === "/dashboard/crm/customers"
              ? pathname.startsWith("/dashboard/crm/customers")
              : item.href === "/dashboard/operations/consumables"
                ? pathname.startsWith("/dashboard/operations/consumables")
                : pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              scroll
              {...moduleNavActiveTabProps(active)}
              className={`shrink-0 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-[#0f2744] text-white"
                  : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </ModuleNavTabStrip>
    </nav>
  );
}
