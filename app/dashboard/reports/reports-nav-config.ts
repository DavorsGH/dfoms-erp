export type ReportNavItem = {
  label: string;
  href: string;
};

export type ReportNavCategory = {
  id: string;
  label: string;
  baseHref: string;
  pageTitle: string;
  items: ReportNavItem[];
};

export const REPORT_NAV_CATEGORIES: ReportNavCategory[] = [
  {
    id: "finance",
    label: "Finance",
    baseHref: "/dashboard/reports/finance",
    pageTitle: "Finance Reports",
    items: [
      {
        label: "Monthly P&L Statement",
        href: "/dashboard/reports/finance/monthly-pl",
      },
      {
        label: "Monthly Balance Sheet",
        href: "/dashboard/reports/finance/monthly-balance-sheet",
      },
      {
        label: "Cash Flow Statement",
        href: "/dashboard/reports/finance/cash-flow",
      },
      {
        label: "Accounts Receivable Aging",
        href: "/dashboard/reports/finance/ar-aging",
      },
      {
        label: "Statutory Liabilities Report",
        href: "/dashboard/reports/finance/statutory-liabilities",
      },
      {
        label: "Fixed Asset & Depreciation Schedule",
        href: "/dashboard/reports/finance/fixed-asset-schedule",
      },
      {
        label: "Capital Contributions Summary",
        href: "/dashboard/reports/finance/capital-contributions",
      },
      {
        label: "Expense Report",
        href: "/dashboard/reports/finance/expense-report",
      },
    ],
  },
  {
    id: "hr-payroll",
    label: "HR & Payroll",
    baseHref: "/dashboard/reports/hr-payroll",
    pageTitle: "HR & Payroll Reports",
    items: [
      {
        label: "Monthly Payroll Summary",
        href: "/dashboard/reports/hr-payroll/monthly-payroll-summary",
      },
      {
        label: "Attendance Summary",
        href: "/dashboard/reports/hr-payroll/attendance-summary",
      },
      {
        label: "Leave Balance",
        href: "/dashboard/reports/hr-payroll/leave-balance",
      },
      {
        label: "Loan Register Summary",
        href: "/dashboard/reports/hr-payroll/loan-register-summary",
      },
      {
        label: "Overtime Summary",
        href: "/dashboard/reports/hr-payroll/overtime-summary",
      },
      {
        label: "Headcount & Contract Expiry",
        href: "/dashboard/reports/hr-payroll/headcount-contract-expiry",
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    baseHref: "/dashboard/reports/operations",
    pageTitle: "Operations Reports",
    items: [
      {
        label: "Quality KPI Summary",
        href: "/dashboard/reports/operations/quality-kpi-summary",
      },
      {
        label: "Site Performance Report",
        href: "/dashboard/reports/operations/site-performance",
      },
      {
        label: "Corrective Action Status",
        href: "/dashboard/reports/operations/corrective-action-status",
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    baseHref: "/dashboard/reports/inventory",
    pageTitle: "Inventory Reports",
    items: [
      {
        label: "Stock on Hand",
        href: "/dashboard/reports/inventory/stock-on-hand",
      },
      {
        label: "Production History",
        href: "/dashboard/reports/inventory/production-history",
      },
      {
        label: "Product Sales",
        href: "/dashboard/reports/inventory/product-sales",
      },
      {
        label: "Internal Consumption",
        href: "/dashboard/reports/inventory/internal-consumption",
      },
    ],
  },
  {
    id: "client-facing",
    label: "Client-Facing",
    baseHref: "/dashboard/reports/client",
    pageTitle: "Client-Facing Reports",
    items: [
      {
        label: "Monthly Client Service Report",
        href: "/dashboard/reports/client/monthly-client-service",
      },
    ],
  },
  {
    id: "incidents",
    label: "Incidents",
    baseHref: "/dashboard/reports/incidents",
    pageTitle: "Incidents Reports",
    items: [
      {
        label: "Individual Incident Report",
        href: "/dashboard/reports/incidents/individual-incident",
      },
      {
        label: "Monthly Incident Summary",
        href: "/dashboard/reports/incidents/monthly-incident-summary",
      },
      {
        label: "Escalated Incidents Report",
        href: "/dashboard/reports/incidents/escalated-incidents",
      },
      {
        label: "Recurring Issue / Trend Report",
        href: "/dashboard/reports/incidents/recurring-issue-trend",
      },
    ],
  },
];

export const REPORT_SIDEBAR_LINKS = REPORT_NAV_CATEGORIES.map((category) => ({
  label: category.label,
  href: category.items[0]?.href ?? category.baseHref,
  categoryId: category.id,
}));

export function findReportCategory(pathname: string): ReportNavCategory | null {
  for (const category of REPORT_NAV_CATEGORIES) {
    const matchesCategory =
      pathname === category.baseHref ||
      pathname.startsWith(`${category.baseHref}/`) ||
      category.items.some(
        (item) =>
          pathname === item.href || pathname.startsWith(`${item.href}/`),
      );

    if (matchesCategory) {
      return category;
    }
  }

  return null;
}

export function findReportCategoryId(pathname: string): string | null {
  return findReportCategory(pathname)?.id ?? null;
}

export function isReportPath(pathname: string): boolean {
  return pathname.startsWith("/dashboard/reports");
}

export function isReportCategoryActive(
  pathname: string,
  categoryId: string,
): boolean {
  const category = REPORT_NAV_CATEGORIES.find((entry) => entry.id === categoryId);
  if (!category) {
    return false;
  }

  return (
    pathname === category.baseHref ||
    pathname.startsWith(`${category.baseHref}/`)
  );
}

export function getDefaultReportHref(categoryId: string): string {
  const category = REPORT_NAV_CATEGORIES.find((entry) => entry.id === categoryId);
  return category?.items[0]?.href ?? "/dashboard/reports/finance/monthly-pl";
}
