"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "My Invoices", href: "/dashboard/client-portal/invoices" },
  {
    label: "My Service Report",
    href: "/dashboard/client-portal/service-report",
  },
  {
    label: "My Sites Performance",
    href: "/dashboard/client-portal/sites-performance",
  },
] as const;

export default function ClientPortalNav() {
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
