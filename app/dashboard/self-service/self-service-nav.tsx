"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ModuleNavTabStrip,
  moduleNavActiveTabProps,
} from "@/app/dashboard/module-nav-tab-strip";

const navItems = [
  { label: "My Payslip", href: "/dashboard/self-service/payslip" },
  { label: "My Attendance", href: "/dashboard/self-service/attendance" },
  { label: "My Leave", href: "/dashboard/self-service/leave" },
  { label: "My Roster", href: "/dashboard/self-service/roster" },
] as const;

export default function SelfServiceNav() {
  const pathname = usePathname();
  const [showRemote, setShowRemote] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/attendance/remote?summary=1")
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }
        return (await response.json()) as { allowed?: boolean };
      })
      .then((body) => {
        if (!cancelled) {
          setShowRemote(Boolean(body?.allowed));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShowRemote(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const items = showRemote
    ? [
        ...navItems.slice(0, 2),
        {
          label: "Log remote attendance",
          href: "/dashboard/self-service/remote-attendance",
        },
        ...navItems.slice(2),
      ]
    : navItems;

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <ModuleNavTabStrip scrollKey={pathname}>
        {items.map((item) => {
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              {...moduleNavActiveTabProps(active)}
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
      </ModuleNavTabStrip>
    </nav>
  );
}
