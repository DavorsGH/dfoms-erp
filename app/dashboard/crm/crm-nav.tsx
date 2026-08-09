"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Customer List", href: "/dashboard/crm/customers" },
  { label: "Sales Pipeline", href: "/dashboard/crm/sales-pipeline" },
  { label: "Quotes", href: "/dashboard/crm/quotes" },
  { label: "Services", href: "/dashboard/crm/services" },
  { label: "Discounts", href: "/dashboard/crm/discounts" },
  {
    label: "Product Catalog",
    href: "/dashboard/crm/products",
    davorsOnly: true,
  },
  { label: "Product Sales", href: "/dashboard/crm/product-sales" },
  { label: "POS", href: "/dashboard/pos" },
  { label: "Sales Log", href: "/dashboard/crm/sales" },
  { label: "Sales Targets", href: "/dashboard/crm/sales-targets" },
  { label: "Commission Rules", href: "/dashboard/crm/commission-rules" },
  { label: "Commissions", href: "/dashboard/crm/commissions" },
  { label: "Sales Forecast", href: "/dashboard/crm/sales-forecast" },
  { label: "Loyalty Settings", href: "/dashboard/crm/loyalty-settings" },
  {
    label: "Email & Promotions",
    href: "/dashboard/crm/email-promotions/templates",
  },
] as const;

type CrmNavProps = {
  showProductCatalog: boolean;
};

export default function CrmNav({ showProductCatalog }: CrmNavProps) {
  const pathname = usePathname();
  const visibleItems = navItems.filter(
    (item) => !("davorsOnly" in item && item.davorsOnly) || showProductCatalog,
  );

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {visibleItems.map((item) => {
          const active = pathname.startsWith("/dashboard/crm/email-promotions")
            ? item.href.startsWith("/dashboard/crm/email-promotions")
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
