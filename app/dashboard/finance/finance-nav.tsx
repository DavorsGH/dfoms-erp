"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Income Register", href: "/dashboard/finance" },
  { label: "Customer Invoices", href: "/dashboard/finance/client-invoices" },
  { label: "Service Contracts", href: "/dashboard/finance/service-contracts" },
  { label: "Customer Receipts", href: "/dashboard/finance/client-receipts" },
  { label: "Expense Register", href: "/dashboard/finance/expenses" },
  { label: "Budget", href: "/dashboard/finance/budget" },
  { label: "Accounts Payable", href: "/dashboard/finance/accounts-payable" },
  { label: "Fixed Assets", href: "/dashboard/finance/fixed-assets" },
  {
    label: "Manual Financial Entries",
    href: "/dashboard/finance/manual-financial-entries",
  },
  { label: "Statutory Ledger", href: "/dashboard/finance/tax-ledger" },
  { label: "Profit & Loss", href: "/dashboard/finance/profit-loss" },
  { label: "Cash Flow", href: "/dashboard/finance/cash-flow" },
  {
    label: "Balance Sheet",
    href: "/dashboard/finance/balance-sheet",
  },
];

export default function FinanceNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {navItems.map((item) => {
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
                  : item.href === "/dashboard/finance/client-receipts"
                  ? pathname === item.href ||
                    pathname.startsWith("/dashboard/finance/client-receipts/")
                  : item.href === "/dashboard/finance/tax-ledger"
                  ? pathname === item.href ||
                    pathname.startsWith("/dashboard/finance/tax-ledger/")
                  : item.href === "/dashboard/finance/budget"
                    ? pathname === item.href ||
                      pathname.startsWith("/dashboard/finance/budget/")
                    : pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
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
