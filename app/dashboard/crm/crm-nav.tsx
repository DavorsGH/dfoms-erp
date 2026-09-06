"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { isCrmNavItemVisibleForRole } from "@/utils/rbac-access";

const navItems = [
  { label: "Customer List", href: "/dashboard/crm/customers" },
  { label: "POS", href: "/dashboard/pos" },
  { label: "Product Sales", href: "/dashboard/crm/product-sales" },
  { label: "Quotations", href: "/dashboard/sales-crm/quotations" },
  { label: "Sales Pipeline", href: "/dashboard/crm/sales-pipeline" },
  { label: "Sales Log", href: "/dashboard/crm/sales" },
  {
    label: "Product Catalog",
    href: "/dashboard/crm/products",
    davorsOnly: true,
  },
  { label: "Services", href: "/dashboard/crm/services" },
  { label: "Discounts", href: "/dashboard/crm/discounts" },
  { label: "Loyalty Settings", href: "/dashboard/crm/loyalty-settings" },
  { label: "Sales Targets", href: "/dashboard/crm/sales-targets" },
  { label: "Sales Forecast", href: "/dashboard/crm/sales-forecast" },
  { label: "Commission Rules", href: "/dashboard/crm/commission-rules" },
  { label: "Commissions", href: "/dashboard/crm/commissions" },
  {
    label: "Email & Promotions",
    href: "/dashboard/crm/email-promotions/templates",
  },
  { label: "Offline sale conflicts", href: "/dashboard/crm/offline-sale-conflicts" },
] as const;

type CrmNavProps = {
  showProductCatalog: boolean;
  userRole: AppRole | null;
};

export default function CrmNav({ showProductCatalog, userRole }: CrmNavProps) {
  const pathname = usePathname();
  const visibleItems = navItems.filter((item) => {
    if ("davorsOnly" in item && item.davorsOnly && !showProductCatalog) {
      return false;
    }

    return isCrmNavItemVisibleForRole(item.href, userRole);
  });

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {visibleItems.map((item) => {
          const active = pathname.startsWith("/dashboard/crm/email-promotions")
            ? item.href.startsWith("/dashboard/crm/email-promotions")
            : pathname.startsWith("/dashboard/sales-crm/quotations")
              ? item.href.startsWith("/dashboard/sales-crm/quotations")
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              scroll
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
