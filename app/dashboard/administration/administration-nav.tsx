"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Service Categories", href: "/dashboard/administration" },
  {
    label: "Expense Categories",
    href: "/dashboard/administration/expense-categories",
  },
  {
    label: "Expense Sub-Categories",
    href: "/dashboard/administration/expense-subcategories",
  },
  { label: "Payment Methods", href: "/dashboard/administration/payment-methods" },
  {
    label: "Asset Categories",
    href: "/dashboard/administration/asset-categories",
  },
  {
    label: "Depreciation Methods",
    href: "/dashboard/administration/depreciation-methods",
  },
  { label: "Approvers", href: "/dashboard/administration/approvers" },
] as const;

export default function AdministrationNav() {
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
