"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ModuleNavTabStrip,
  moduleNavActiveTabProps,
} from "@/app/dashboard/module-nav-tab-strip";

const suppliersNavItem = {
  label: "Suppliers",
  href: "/dashboard/finance/suppliers",
} as const;

const navItems = [
  { label: "Income Register", href: "/dashboard/finance" },
  { label: "Customer Invoices", href: "/dashboard/finance/client-invoices" },
  { label: "Customer Receipts", href: "/dashboard/finance/client-receipts" },
  { label: "Credit Notes", href: "/dashboard/crm/credit-notes" },
  { label: "Service Contracts", href: "/dashboard/finance/service-contracts" },
  { label: "Expense Register", href: "/dashboard/finance/expenses" },
  { label: "Accounts Payable", href: "/dashboard/finance/accounts-payable" },
  { label: "Supplier Contracts", href: "/dashboard/finance/supplier-contracts" },
  suppliersNavItem,
  { label: "Fixed Assets", href: "/dashboard/finance/fixed-assets" },
  { label: "Statutory Ledger", href: "/dashboard/finance/tax-ledger" },
  { label: "Staff Welfare Fund", href: "/dashboard/finance/staff-welfare-fund" },
  {
    label: "Manual Financial Entries",
    href: "/dashboard/finance/manual-financial-entries",
  },
  { label: "Budget", href: "/dashboard/finance/budget" },
  { label: "Profit & Loss", href: "/dashboard/finance/profit-loss" },
  {
    label: "Balance Sheet",
    href: "/dashboard/finance/balance-sheet",
  },
  { label: "Cash Flow", href: "/dashboard/finance/cash-flow" },
];

type FinanceNavProps = {
  /** When true, show only the Suppliers tab (inventory-tier roles). */
  suppliersOnly?: boolean;
};

export default function FinanceNav({ suppliersOnly = false }: FinanceNavProps) {
  const pathname = usePathname();
  const visibleItems = suppliersOnly ? [suppliersNavItem] : navItems;

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <ModuleNavTabStrip scrollKey={pathname}>
        {visibleItems.map((item) => {
          const active =
            item.href === "/dashboard/finance/balance-sheet"
              ? pathname === item.href ||
                pathname.startsWith("/dashboard/finance/balance-sheet/")
              : item.href === "/dashboard/finance/client-invoices"
                ? pathname === item.href ||
                  pathname.startsWith("/dashboard/finance/client-invoices/")
                : item.href === "/dashboard/finance/service-contracts"
                  ? pathname === item.href ||
                    pathname.startsWith("/dashboard/finance/service-contracts/")
                  : item.href === "/dashboard/finance/supplier-contracts"
                    ? pathname === item.href ||
                      pathname.startsWith("/dashboard/finance/supplier-contracts/")
                    : item.href === "/dashboard/finance/suppliers"
                      ? pathname === item.href ||
                        pathname.startsWith("/dashboard/finance/suppliers/")
                      : item.href === "/dashboard/finance/client-receipts"
                  ? pathname === item.href ||
                    pathname.startsWith("/dashboard/finance/client-receipts/")
                  : item.href === "/dashboard/finance/tax-ledger"
                  ? pathname === item.href ||
                    pathname.startsWith("/dashboard/finance/tax-ledger/")
                  : item.href === "/dashboard/finance/staff-welfare-fund"
                    ? pathname === item.href ||
                      pathname.startsWith("/dashboard/finance/staff-welfare-fund/")
                    : item.href === "/dashboard/finance/budget"
                    ? pathname === item.href ||
                      pathname.startsWith("/dashboard/finance/budget/")
                    : item.href === "/dashboard/crm/credit-notes"
                      ? pathname === item.href ||
                        pathname.startsWith("/dashboard/crm/credit-notes/")
                      : pathname === item.href;

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
