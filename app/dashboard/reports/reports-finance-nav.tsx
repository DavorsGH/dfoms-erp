"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const financeReportItems = [
  {
    label: "Monthly P&L",
    href: "/dashboard/reports/finance/monthly-pl",
  },
  {
    label: "Monthly Balance Sheet",
    href: "/dashboard/reports/finance/monthly-balance-sheet",
  },
  {
    label: "Cash Flow",
    href: "/dashboard/reports/finance/cash-flow",
  },
  {
    label: "AR Aging",
    href: "/dashboard/reports/finance/ar-aging",
  },
  {
    label: "Statutory Liabilities",
    href: "/dashboard/reports/finance/statutory-liabilities",
  },
  {
    label: "Fixed Asset Schedule",
    href: "/dashboard/reports/finance/fixed-asset-schedule",
  },
  {
    label: "Capital Contributions",
    href: "/dashboard/reports/finance/capital-contributions",
  },
] as const;

export default function ReportsFinanceNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Finance
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {financeReportItems.map((item) => {
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
