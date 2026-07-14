"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "My Payslip", href: "/dashboard/self-service/payslip" },
  { label: "My Attendance", href: "/dashboard/self-service/attendance" },
  { label: "My Leave", href: "/dashboard/self-service/leave" },
  { label: "My Roster", href: "/dashboard/self-service/roster" },
] as const;

export default function SelfServiceNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {navItems.map((item) => {
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
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
