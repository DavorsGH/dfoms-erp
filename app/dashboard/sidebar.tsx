"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
  return pathname.startsWith(href);
}

export default function Sidebar({ isSuperAdmin }: SidebarProps) {
  const pathname = usePathname();
  const navItems = isSuperAdmin
    ? [...baseNavItems, ...superAdminNavItems]
    : baseNavItems;

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

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {navItems.map((item) => {
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
