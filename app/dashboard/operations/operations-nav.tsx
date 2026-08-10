"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Duty Roster", href: "/dashboard/operations/duty-roster" },
  { label: "Roster History", href: "/dashboard/operations/roster-history" },
  { label: "Sites", href: "/dashboard/operations/sites" },
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
};

export default function OperationsNav({
  showCustomerList = false,
}: OperationsNavProps) {
  const pathname = usePathname();
  const visibleItems = showCustomerList
    ? [
        { label: "Customer List", href: "/dashboard/crm/customers" },
        ...navItems,
      ]
    : navItems;

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {visibleItems.map((item) => {
          const active =
            item.href === "/dashboard/crm/customers"
              ? pathname.startsWith("/dashboard/crm/customers")
              : pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              scroll
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
      </div>
    </nav>
  );
}
