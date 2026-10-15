"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ModuleNavTabStrip,
  moduleNavActiveTabProps,
} from "@/app/dashboard/module-nav-tab-strip";

const storeTabs = [
  { label: "Store stock", href: "/dashboard/operations/consumables/store" },
  { label: "Receive", href: "/dashboard/operations/consumables/receive" },
  { label: "Issue to site", href: "/dashboard/operations/consumables/issue" },
  { label: "Movements", href: "/dashboard/operations/consumables/movements" },
  { label: "Site usage", href: "/dashboard/operations/consumables/site-usage" },
  { label: "Items", href: "/dashboard/operations/consumables/items" },
] as const;

type ConsumablesStoreNavProps = {
  showLegacyTab: boolean;
};

export default function ConsumablesStoreNav({
  showLegacyTab,
}: ConsumablesStoreNavProps) {
  const pathname = usePathname();
  const tabs = showLegacyTab
    ? [
        ...storeTabs,
        {
          label: "Old stock sheet",
          href: "/dashboard/operations/consumables/legacy",
        },
      ]
    : storeTabs;

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <ModuleNavTabStrip scrollKey={pathname}>
        {tabs.map((item) => {
          const active =
            pathname === item.href ||
            (item.href === "/dashboard/operations/consumables/store" &&
              pathname === "/dashboard/operations/consumables");

          return (
            <Link
              key={item.href}
              href={item.href}
              {...moduleNavActiveTabProps(active)}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
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
