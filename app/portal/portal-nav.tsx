"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Home", href: "/portal/dashboard" },
  { label: "Payments", href: "/portal/payments" },
  { label: "Repairs", href: "/portal/repairs" },
  { label: "Complaints", href: "/portal/complaints" },
  { label: "My Issues", href: "/portal/issues" },
] as const;

export default function PortalNav() {
  const pathname = usePathname();

  return (
    <nav className="rounded-md border border-slate-200 bg-white px-3 py-3 sm:px-4">
      <div className="flex gap-2 overflow-x-auto">
        {navItems.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 cursor-pointer whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
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
