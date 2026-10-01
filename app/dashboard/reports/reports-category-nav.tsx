"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ModuleNavTabStrip,
  moduleNavActiveTabProps,
} from "@/app/dashboard/module-nav-tab-strip";
import { REPORT_NAV_CATEGORIES } from "./reports-nav-config";

type ReportsCategoryNavProps = {
  categoryId: string;
};

export default function ReportsCategoryNav({
  categoryId,
}: ReportsCategoryNavProps) {
  const pathname = usePathname();
  const category = REPORT_NAV_CATEGORIES.find((entry) => entry.id === categoryId);

  if (!category) {
    return null;
  }

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <ModuleNavTabStrip scrollKey={`${categoryId}:${pathname}`}>
        {category.items.map((item) => {
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              scroll
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
