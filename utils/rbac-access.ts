import type { AppRole } from "@/app/dashboard/user-account-types";

export const FINANCE_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
];

export const HR_PAYROLL_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
];

export const EMPLOYEES_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
  "operations_manager",
  "supervisor",
];

export const EMPLOYEES_EDIT_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
];

export const EMPLOYEES_SALARY_VIEW_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
];

export const OPERATIONS_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "operations_manager",
  "supervisor",
  "hr",
];

export const OPERATIONS_FULL_EDIT_ROLES: readonly AppRole[] = [
  "super_admin",
  "operations_manager",
];

export const INVENTORY_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "operations_manager",
  "finance",
  "sales_rep",
];

export const INVENTORY_EDIT_ROLES: readonly AppRole[] = [
  "super_admin",
  "operations_manager",
];

export const CRM_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
];

export const POS_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
  "sales_rep",
];

export const PAYROLL_PERIOD_MANAGE_ROLES: readonly AppRole[] = [
  "super_admin",
  "hr",
];

export const START_ROTATION_ROLES: readonly AppRole[] = [
  "super_admin",
  "operations_manager",
];

export const SELF_SERVICE_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
  "operations_manager",
  "supervisor",
  "employee",
];

export const CLIENT_PORTAL_SECTION_ROLES: readonly AppRole[] = ["client"];

export const LEAVE_BALANCE_MANAGE_ROLES: readonly AppRole[] = [
  "super_admin",
  "hr",
];

export const REPORT_CATEGORY_ROLES: Record<string, readonly AppRole[]> = {
  finance: ["super_admin", "finance", "hr"],
  "hr-payroll": ["super_admin", "finance", "hr"],
  operations: ["super_admin", "operations_manager", "supervisor"],
  inventory: ["super_admin", "operations_manager", "finance"],
  sales: CRM_SECTION_ROLES,
  "client-facing": ["super_admin"],
  incidents: ["super_admin", "operations_manager", "supervisor"],
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
): boolean {
  const allowed = REPORT_CATEGORY_ROLES[categoryId];
  return allowed ? roleIn(role, allowed) : false;
}

export function getAccessibleReportCategoryIds(role: AppRole | null): string[] {
  return Object.entries(REPORT_CATEGORY_ROLES)
    .filter(([, allowed]) => roleIn(role, allowed))
    .map(([categoryId]) => categoryId);
}

export function getFirstAccessibleReportCategoryId(
  role: AppRole | null,
): string {
  return getAccessibleReportCategoryIds(role)[0] ?? "finance";
}

export function getDashboardVisibility(role: AppRole | null): DashboardVisibility {
  const showFinancialSummary = canAccessFinanceSection(role);
  const showFinancialCharts = canAccessFinanceSection(role);
  const showPayrollPanel = canAccessHrPayrollSection(role);
  const showInventoryAlerts =
    role === "super_admin" ||
    role === "operations_manager" ||
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

  if (canAccessHrManagementSection(role)) {
    items.push({ label: "HR Management", href: "/dashboard/hr-payroll" });
  }

  if (canAccessOperationsSection(role)) {
    items.push({ label: "Operations", href: "/dashboard/operations" });
  }

  if (canAccessInventorySection(role)) {
    items.push({ label: "Inventory", href: "/dashboard/inventory" });
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

  return items;
}
