"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getActiveInventoryGroup,
  isInventoryItemActive,
} from "./inventory-nav-config";

const tabClassName = (active: boolean) =>
  `shrink-0 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
    active
      ? "bg-[#0f2744] text-white"
      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
  }`;

export default function InventoryNav() {
  const pathname = usePathname();
  const activeGroup = getActiveInventoryGroup(pathname);

  // Finished Products is a single page with no sibling tabs.
  if (!activeGroup || activeGroup.items.length < 2) {
    return null;
  }

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {activeGroup.items.map((item) => {
          const active = isInventoryItemActive(pathname, item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              scroll
              className={tabClassName(active)}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
