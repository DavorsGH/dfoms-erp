"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  isReportCategoryActive,
  isReportPath,
  REPORT_SIDEBAR_LINKS,
} from "./reports/reports-nav-config";

const baseNavItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Finance", href: "/dashboard/finance" },
  { label: "HR & Payroll", href: "/dashboard/hr-payroll" },
  { label: "Employees", href: "/dashboard/employees" },
  { label: "Operations", href: "/dashboard/operations" },
  { label: "Reports", href: "/dashboard/reports" },
] as const;

const superAdminNavItems = [
  { label: "Administration", href: "/dashboard/administration" },
  { label: "User Accounts", href: "/dashboard/user-accounts" },
] as const;

type SidebarProps = {
  isSuperAdmin: boolean;
};

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }

  if (href === "/dashboard/reports") {
    return isReportPath(pathname);
  }

  return pathname.startsWith(href);
}

export default function Sidebar({ isSuperAdmin }: SidebarProps) {
  const pathname = usePathname();
  const navItems = isSuperAdmin
    ? [...baseNavItems, ...superAdminNavItems]
    : baseNavItems;
  const reportsActive = isReportPath(pathname);

  return (
    <aside className="flex min-h-screen w-56 shrink-0 flex-col bg-[#0f2744] text-white">
      <div className="flex items-center gap-4 border-b border-white/10 px-5 py-8">
        <Image
          src="/logo.jpg"
          alt="DFOMS ERP logo"
          width={80}
          height={80}
          className="h-20 w-20 shrink-0 rounded-sm object-cover"
        />
        <div className="min-w-0">
          <p className="text-lg font-semibold leading-tight text-emerald-400">
            Davors Facilities
          </p>
          <p className="mt-0.5 whitespace-nowrap text-sm font-medium leading-tight text-white/90">
            ERP System
          </p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          if (item.href === "/dashboard/reports") {
            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    reportsActive
                      ? "bg-white/15 text-white"
                      : "text-white/75 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
                {reportsActive ? (
                  <div className="ml-3 mt-1 space-y-0.5 border-l border-white/10 pl-2">
                    {REPORT_SIDEBAR_LINKS.map((link) => {
                      const categoryActive = isReportCategoryActive(
                        pathname,
                        link.categoryId,
                      );

                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          className={`block rounded-md px-2 py-1.5 text-xs font-medium leading-snug transition-colors ${
                            categoryActive
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "text-white/70 hover:bg-white/10 hover:text-white"
                          }`}
                        >
                          {link.label}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          }

          const active = isActive(pathname, item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-white/15 text-white"
                  : "text-white/75 hover:bg-white/10 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
