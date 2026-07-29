"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  {
    label: "Templates",
    href: "/dashboard/hr-payroll/employee-announcements/templates",
  },
] as const;

export default function EmployeeAnnouncementsNav() {
  const pathname = usePathname();

  return (
    <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-px">
      {tabs.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border border-b-white border-slate-200 bg-white text-[#0f2744]"
                : "text-slate-600 hover:text-[#0f2744]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
