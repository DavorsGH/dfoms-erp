"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Finance", href: "/dashboard/finance" },
  { label: "HR & Payroll", href: "/dashboard/hr-payroll" },
  { label: "Operations", href: "/dashboard/operations" },
  { label: "Reports", href: "/dashboard/reports" },
  { label: "Administration", href: "/dashboard/administration" },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname.startsWith(href);
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex min-h-screen w-56 shrink-0 flex-col bg-[#0f2744] text-white">
      <div className="flex items-center gap-4 border-b border-white/10 px-5 py-6">
        <Image
          src="/logo.jpg"
          alt="DFOMS ERP logo"
          width={56}
          height={56}
          className="h-14 w-14 shrink-0 rounded-sm object-cover"
        />
        <div className="min-w-0">
          <p className="text-base font-semibold leading-snug text-emerald-400">
            Davors Facilities
          </p>
          <p className="text-sm font-medium leading-snug text-white/90">
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
