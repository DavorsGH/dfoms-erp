import type { AppRole } from "@/app/dashboard/user-account-types";

export const FINANCE_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
  "director",
];

export const HR_PAYROLL_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
  "director",
];

export const EMPLOYEES_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
  "director",
  "operations_manager",
  "supervisor",
];

export const EMPLOYEES_EDIT_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
  "director",
];

export const EMPLOYEES_SALARY_VIEW_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
  "director",
];

export const OPERATIONS_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "operations_manager",
  "director",
  "supervisor",
  "hr",
];

export const OPERATIONS_FULL_EDIT_ROLES: readonly AppRole[] = [
  "super_admin",
  "operations_manager",
  "director",
];

export const INVENTORY_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "operations_manager",
  "director",
  "finance",
  "sales_rep",
];

export const INVENTORY_EDIT_ROLES: readonly AppRole[] = [
  "super_admin",
  "operations_manager",
  "director",
];

export const CRM_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
  "director",
  "operations_manager",
];

/** Customer List only — supervisors reach /dashboard/crm/customers, not full CRM. */
export const CRM_CUSTOMER_LIST_ROLES: readonly AppRole[] = [
  ...CRM_SECTION_ROLES,
  "supervisor",
];

/** Create/edit client quotations (Sales & CRM → Quotations). */
export const CRM_QUOTATIONS_EDIT_ROLES: readonly AppRole[] = [
  ...CRM_SECTION_ROLES,
  "sales_rep",
];

export const POS_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
  "director",
  "sales_rep",
];

export const PAYROLL_PERIOD_MANAGE_ROLES: readonly AppRole[] = [
  "super_admin",
  "hr",
  "director",
];

/** HR/admin roles for employee announcement templates and campaigns. */
export const EMPLOYEE_ANNOUNCEMENTS_ROLES: readonly AppRole[] = [
  "super_admin",
  "hr",
  "director",
];

export const START_ROTATION_ROLES: readonly AppRole[] = [
  "super_admin",
  "operations_manager",
  "director",
];

export const SELF_SERVICE_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
  "director",
  "operations_manager",
  "supervisor",
  "employee",
];

export const CLIENT_PORTAL_SECTION_ROLES: readonly AppRole[] = ["client"];

export const LEAVE_BALANCE_MANAGE_ROLES: readonly AppRole[] = [
  "super_admin",
  "hr",
  "director",
];

export const REPORT_CATEGORY_ROLES: Record<string, readonly AppRole[]> = {
  finance: ["super_admin", "finance", "hr", "director"],
  "hr-payroll": ["super_admin", "finance", "hr", "director"],
  operations: ["super_admin", "operations_manager", "director", "supervisor"],
  inventory: ["super_admin", "operations_manager", "director", "finance"],
  sales: CRM_SECTION_ROLES,
  "client-facing": ["super_admin"],
  incidents: ["super_admin", "operations_manager", "director", "supervisor"],
  /** Gated by `isDavorsPlatformRealEstateStaff()` — not a flat global role list. */
  "real-estate": ["super_admin"],
};

export type DashboardVisibility = {
  showFinancialSummary: boolean;
  showFinancialCharts: boolean;
  showPayrollPanel: boolean;
  showInventoryAlerts: boolean;
};

export type SidebarNavItem = {
  label: string;
  href: string;
};

export function roleIn(role: AppRole | null, allowed: readonly AppRole[]): boolean {
  return role !== null && allowed.includes(role);
}

export function canAccessFinanceSection(role: AppRole | null): boolean {
  return roleIn(role, FINANCE_SECTION_ROLES);
}

export function canAccessHrPayrollSection(role: AppRole | null): boolean {
  return roleIn(role, HR_PAYROLL_SECTION_ROLES);
}

export function canAccessHrManagementSection(role: AppRole | null): boolean {
  return (
    canAccessHrPayrollSection(role) || canAccessEmployeesSection(role)
  );
}

export function canAccessEmployeesSection(role: AppRole | null): boolean {
  return roleIn(role, EMPLOYEES_SECTION_ROLES);
}

export function canEditEmployees(role: AppRole | null): boolean {
  return roleIn(role, EMPLOYEES_EDIT_ROLES);
}

export function canViewEmployeeSalary(role: AppRole | null): boolean {
  return roleIn(role, EMPLOYEES_SALARY_VIEW_ROLES);
}

export function canAccessOperationsSection(role: AppRole | null): boolean {
  return roleIn(role, OPERATIONS_SECTION_ROLES);
}

export function canStartRotation(role: AppRole | null): boolean {
  return roleIn(role, START_ROTATION_ROLES);
}

export function canAccessSelfServiceSection(role: AppRole | null): boolean {
  return roleIn(role, SELF_SERVICE_SECTION_ROLES);
}

export function canAccessClientPortalSection(role: AppRole | null): boolean {
  return roleIn(role, CLIENT_PORTAL_SECTION_ROLES);
}

export function canManageLeaveBalances(role: AppRole | null): boolean {
  return roleIn(role, LEAVE_BALANCE_MANAGE_ROLES);
}

export function canAccessInventorySection(role: AppRole | null): boolean {
  return roleIn(role, INVENTORY_SECTION_ROLES);
}

export function canAccessCrmSection(role: AppRole | null): boolean {
  return roleIn(role, CRM_SECTION_ROLES);
}

export function isCrmCustomerListPath(pathname: string): boolean {
  return (
    pathname === "/dashboard/crm/customers" ||
    pathname.startsWith("/dashboard/crm/customers/")
  );
}

export function canAccessCrmCustomerList(role: AppRole | null): boolean {
  return roleIn(role, CRM_CUSTOMER_LIST_ROLES);
}

export function canAccessPosSection(role: AppRole | null): boolean {
  return roleIn(role, POS_SECTION_ROLES);
}

export function canEditInventory(role: AppRole | null): boolean {
  return roleIn(role, INVENTORY_EDIT_ROLES);
}

export function canManagePayrollPeriod(role: AppRole | null): boolean {
  return roleIn(role, PAYROLL_PERIOD_MANAGE_ROLES);
}

export function canAccessReportCategory(
  role: AppRole | null,
  categoryId: string,
  options?: { showRealEstate?: boolean },
): boolean {
  if (categoryId === "real-estate") {
    return options?.showRealEstate === true;
  }

  const allowed = REPORT_CATEGORY_ROLES[categoryId];
  return allowed ? roleIn(role, allowed) : false;
}

export function getAccessibleReportCategoryIds(
  role: AppRole | null,
  options?: { showRealEstate?: boolean },
): string[] {
  return Object.entries(REPORT_CATEGORY_ROLES)
    .filter(([categoryId, allowed]) => {
      if (categoryId === "real-estate") {
        return options?.showRealEstate === true;
      }
      return roleIn(role, allowed);
    })
    .map(([categoryId]) => categoryId);
}

export function getFirstAccessibleReportCategoryId(
  role: AppRole | null,
  options?: { showRealEstate?: boolean },
): string {
  return getAccessibleReportCategoryIds(role, options)[0] ?? "finance";
}

export function getDashboardVisibility(role: AppRole | null): DashboardVisibility {
  const showFinancialSummary = canAccessFinanceSection(role);
  const showFinancialCharts = canAccessFinanceSection(role);
  const showPayrollPanel = canAccessHrPayrollSection(role);
  const showInventoryAlerts =
    role === "super_admin" ||
    role === "operations_manager" ||
    role === "director" ||
    role === "finance";

  return {
    showFinancialSummary,
    showFinancialCharts,
    showPayrollPanel,
    showInventoryAlerts,
  };
}

export function getSidebarNavItems(role: AppRole | null): SidebarNavItem[] {
  const items: SidebarNavItem[] = [{ label: "Dashboard", href: "/dashboard" }];

  // POS lives inside Sales & CRM for users who can access that section; only
  // POS-only roles (e.g. sales_rep) still get a standalone sidebar link.
  if (canAccessPosSection(role) && !canAccessCrmSection(role)) {
    items.push({ label: "POS", href: "/dashboard/pos" });
  }

  if (canAccessFinanceSection(role)) {
    items.push({ label: "Finance", href: "/dashboard/finance" });
  }

  if (canAccessCrmSection(role)) {
    items.push({ label: "Sales & CRM", href: "/dashboard/crm" });
  }

  if (canAccessInventorySection(role)) {
    items.push({ label: "Inventory", href: "/dashboard/inventory" });
  }

  if (canAccessOperationsSection(role)) {
    items.push({ label: "Operations", href: "/dashboard/operations" });
  }

  if (canAccessHrManagementSection(role)) {
    items.push({ label: "HR Management", href: "/dashboard/hr-payroll" });
  }

  if (canAccessSelfServiceSection(role)) {
    items.push({ label: "Self-Service", href: "/dashboard/self-service" });
  }

  if (canAccessClientPortalSection(role)) {
    items.push({ label: "Customer Portal", href: "/dashboard/client-portal" });
  }

  if (getAccessibleReportCategoryIds(role).length > 0) {
    items.push({ label: "Reports", href: "/dashboard/reports" });
  }

  if (role === "super_admin") {
    items.push({ label: "Administration", href: "/dashboard/administration" });
  }

  if (role === "super_admin" || role === "director") {
    items.push({ label: "Login Activity", href: "/dashboard/login-activity" });
  }

  return items;
}
