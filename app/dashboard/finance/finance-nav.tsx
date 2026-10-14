"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useBusinessUnitView } from "@/app/dashboard/business-unit-view-context";
import {
  ModuleNavTabStrip,
  moduleNavActiveTabProps,
} from "@/app/dashboard/module-nav-tab-strip";

export type FinanceNavItem = {
  label: string;
  href: string;
};

const suppliersNavItem: FinanceNavItem = {
  label: "Suppliers",
  href: "/dashboard/finance/suppliers",
};

const interUnitTransfersNavItem: FinanceNavItem = {
  label: "Inter-unit Transfers",
  href: "/dashboard/finance/business-unit-transfers",
};

/** Single source of truth for Finance module tab order (four groups). */
export const financeNavGroups: FinanceNavItem[][] = [
  [
    { label: "Service Contracts", href: "/dashboard/finance/service-contracts" },
    { label: "Customer Invoices", href: "/dashboard/finance/client-invoices" },
    { label: "Customer Receipts", href: "/dashboard/finance/client-receipts" },
    { label: "Credit Notes", href: "/dashboard/crm/credit-notes" },
    { label: "Income Register", href: "/dashboard/finance" },
  ],
  [
    suppliersNavItem,
    {
      label: "Supplier Contracts",
      href: "/dashboard/finance/supplier-contracts",
    },
    { label: "Accounts Payable", href: "/dashboard/finance/accounts-payable" },
    { label: "Expense Register", href: "/dashboard/finance/expenses" },
  ],
  [
    { label: "Fixed Assets", href: "/dashboard/finance/fixed-assets" },
    { label: "Statutory Ledger", href: "/dashboard/finance/tax-ledger" },
    {
      label: "Staff Welfare Fund",
      href: "/dashboard/finance/staff-welfare-fund",
    },
    interUnitTransfersNavItem,
    {
      label: "Manual Financial Entries",
      href: "/dashboard/finance/manual-financial-entries",
    },
  ],
  [
    { label: "Budget", href: "/dashboard/finance/budget" },
    { label: "Profit & Loss", href: "/dashboard/finance/profit-loss" },
    {
      label: "Balance Sheet",
      href: "/dashboard/finance/balance-sheet",
    },
    { label: "Cash Flow", href: "/dashboard/finance/cash-flow" },
  ],
];

export function isFinanceNavItemActive(
  pathname: string,
  item: FinanceNavItem,
): boolean {
  if (item.href === "/dashboard/finance/balance-sheet") {
    return (
      pathname === item.href ||
      pathname.startsWith("/dashboard/finance/balance-sheet/")
    );
  }
  if (item.href === "/dashboard/finance/client-invoices") {
    return (
      pathname === item.href ||
      pathname.startsWith("/dashboard/finance/client-invoices/")
    );
  }
  if (item.href === "/dashboard/finance/service-contracts") {
    return (
      pathname === item.href ||
      pathname.startsWith("/dashboard/finance/service-contracts/")
    );
  }
  if (item.href === "/dashboard/finance/supplier-contracts") {
    return (
      pathname === item.href ||
      pathname.startsWith("/dashboard/finance/supplier-contracts/")
    );
  }
  if (item.href === "/dashboard/finance/suppliers") {
    return (
      pathname === item.href ||
      pathname.startsWith("/dashboard/finance/suppliers/")
    );
  }
  if (item.href === "/dashboard/finance/client-receipts") {
    return (
      pathname === item.href ||
      pathname.startsWith("/dashboard/finance/client-receipts/")
    );
  }
  if (item.href === "/dashboard/finance/tax-ledger") {
    return (
      pathname === item.href ||
      pathname.startsWith("/dashboard/finance/tax-ledger/")
    );
  }
  if (item.href === "/dashboard/finance/staff-welfare-fund") {
    return (
      pathname === item.href ||
      pathname.startsWith("/dashboard/finance/staff-welfare-fund/")
    );
  }
  if (item.href === "/dashboard/finance/business-unit-transfers") {
    return (
      pathname === item.href ||
      pathname.startsWith("/dashboard/finance/business-unit-transfers/")
    );
  }
  if (item.href === "/dashboard/finance/budget") {
    return (
      pathname === item.href ||
      pathname.startsWith("/dashboard/finance/budget/")
    );
  }
  if (item.href === "/dashboard/crm/credit-notes") {
    return (
      pathname === item.href ||
      pathname.startsWith("/dashboard/crm/credit-notes/")
    );
  }

  return pathname === item.href;
}

const financeNavGroupDividerClassName =
  "mx-0.5 h-8 w-px shrink-0 self-center bg-slate-200";

type FinanceNavProps = {
  /** When true, show only the Suppliers tab (inventory-tier roles). */
  suppliersOnly?: boolean;
};

export default function FinanceNav({ suppliersOnly = false }: FinanceNavProps) {
  const pathname = usePathname();
  const { units } = useBusinessUnitView();
  const showInterUnitTransfersTab = units.length >= 2;

  const visibleGroups = useMemo(() => {
    if (suppliersOnly) {
      return [[suppliersNavItem]];
    }
    return financeNavGroups.map((group) =>
      group.filter(
        (item) =>
          item.href !== interUnitTransfersNavItem.href ||
          showInterUnitTransfersTab,
      ),
    );
  }, [suppliersOnly, showInterUnitTransfersTab]);

  const nonEmptyGroupIndexes = visibleGroups
    .map((group, index) => (group.length > 0 ? index : -1))
    .filter((index) => index >= 0);

  return (
    <nav className="mb-6 border-b border-slate-200 pb-4">
      <ModuleNavTabStrip scrollKey={pathname}>
        {visibleGroups.map((group, groupIndex) => {
          if (group.length === 0) {
            return null;
          }

          const groupPosition = nonEmptyGroupIndexes.indexOf(groupIndex);
          const showLeadingDivider =
            groupPosition > 0 && nonEmptyGroupIndexes[groupPosition - 1] != null;

          return (
            <span key={`group-${groupIndex}`} className="contents">
              {showLeadingDivider ? (
                <span
                  className={financeNavGroupDividerClassName}
                  aria-hidden
                />
              ) : null}
              {group.map((item) => {
                const active = isFinanceNavItemActive(pathname, item);

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
            </span>
          );
        })}
      </ModuleNavTabStrip>
    </nav>
  );
}
