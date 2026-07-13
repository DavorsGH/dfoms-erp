"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const hrReportItems = [
  {
    label: "Monthly Payroll Summary",
    href: "/dashboard/reports/hr-payroll/monthly-payroll-summary",
  },
  {
    label: "Attendance Summary",
    href: "/dashboard/reports/hr-payroll/attendance-summary",
  },
  {
    label: "Leave Balance",
    href: "/dashboard/reports/hr-payroll/leave-balance",
  },
  {
    label: "Loan Register Summary",
    href: "/dashboard/reports/hr-payroll/loan-register-summary",
  },
  {
    label: "Overtime Summary",
    href: "/dashboard/reports/hr-payroll/overtime-summary",
  },
  {
    label: "Headcount & Contract Expiry",
    href: "/dashboard/reports/hr-payroll/headcount-contract-expiry",
  },
] as const;

export default function ReportsHrNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        HR &amp; Payroll
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {hrReportItems.map((item) => {
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
