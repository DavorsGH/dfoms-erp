"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Attendance", href: "/dashboard/hr-payroll/attendance" },
  { label: "Leave", href: "/dashboard/hr-payroll/leave" },
  { label: "Overtime", href: "/dashboard/hr-payroll/overtime" },
  { label: "Loans", href: "/dashboard/hr-payroll/loans" },
  {
    label: "Payroll Processing",
    href: "/dashboard/hr-payroll/payroll-processing",
  },
  {
    label: "Payroll History",
    href: "/dashboard/hr-payroll/payroll-history",
  },
  {
    label: "Payslip",
    href: "/dashboard/hr-payroll/payslip",
  },
] as const;

export default function HrPayrollNav() {
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
