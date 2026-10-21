import type { AppRole } from "@/app/dashboard/user-account-types";

export const FINANCE_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "finance_admin",
  "hr",
  "director",
];

export const HR_PAYROLL_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "finance_admin",
  "hr",
  "director",
];

export const EMPLOYEES_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "finance_admin",
  "hr",
  "director",
  "operations_manager",
  "supervisor",
];

export const EMPLOYEES_EDIT_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "finance_admin",
  "hr",
  "director",
];

export const EMPLOYEES_SALARY_VIEW_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "finance_admin",
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

/** Read-only Operations nav (duty roster, sites, registers, reports). */
export const OPERATIONS_VIEW_ROLES: readonly AppRole[] = ["finance_admin"];

export const OPERATIONS_LAYOUT_ROLES: readonly AppRole[] = [
  ...OPERATIONS_SECTION_ROLES,
  ...OPERATIONS_VIEW_ROLES,
];

/** Suppliers, POs, product purchases, internal consumption (finance_admin included). */
export const PROCUREMENT_EDIT_ROLES: readonly AppRole[] = [
  "super_admin",
  "operations_manager",
  "director",
  "finance_admin",
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
  "finance_admin",
  "sales_rep",
];

/** Finance → Suppliers (same access as former Inventory → Purchasing → Suppliers). */
export const FINANCE_SUPPLIERS_PAGE_ROLES: readonly AppRole[] =
  INVENTORY_SECTION_ROLES;

/** Stock adjustments, inventory go-live config, and legacy “full inventory ops” guards. */
export const INVENTORY_EDIT_ROLES: readonly AppRole[] = [
  "super_admin",
  "operations_manager",
  "director",
];

/** Catalog, batches, photos, product bulk import — not stock adjustments or go-live. */
export const INVENTORY_OPERATOR_ROLES: readonly AppRole[] = [
  ...INVENTORY_EDIT_ROLES,
  "finance_admin",
];

export const INVENTORY_GO_LIVE_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "director",
];

/** Full Sales & CRM tabs (admin/manager). Excludes sales_rep scoped subset. */
export const CRM_FULL_FEATURE_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "finance_admin",
  "hr",
  "director",
  "operations_manager",
];

/** Roles that may enter Sales & CRM (full or sales_rep scoped subset). */
export const CRM_SECTION_ROLES: readonly AppRole[] = [
  ...CRM_FULL_FEATURE_ROLES,
  "sales_rep",
];

/** Customer List only — supervisors reach /dashboard/crm/customers, not full CRM. */
export const CRM_CUSTOMER_LIST_ROLES: readonly AppRole[] = [
  ...CRM_SECTION_ROLES,
  "supervisor",
];

/** Create/edit client quotations (Sales & CRM → Quotations). */
export const CRM_QUOTATIONS_EDIT_ROLES: readonly AppRole[] = [
  ...CRM_SECTION_ROLES,
];

/** CRM nav tabs visible to sales_rep (subset of Sales & CRM). */
export const CRM_SALES_REP_NAV_HREFS: readonly string[] = [
  "/dashboard/crm/customers",
  "/dashboard/sales-crm/quotations",
  "/dashboard/pos",
  "/dashboard/pos/scanner-setup",
  "/dashboard/crm/sales",
  "/dashboard/crm/credit-notes",
];

/** /dashboard/crm/* paths sales_rep may open (layout + defense in depth). */
export const CRM_SALES_REP_ALLOWED_PATH_PREFIXES: readonly string[] = [
  "/dashboard/crm/customers",
  "/dashboard/crm/product-sales",
  "/dashboard/crm/sales",
  "/dashboard/crm/credit-notes",
];

export const DEVICES_HUB_ROLES: readonly AppRole[] = [
  "super_admin",
  "director",
  "hr",
  "operations_manager",
  "finance_admin",
];

/** Add, edit, disable devices, PIN mapping, and device settings. */
export const ATTENDANCE_DEVICE_WRITE_ROLES: readonly AppRole[] = [
  "super_admin",
  "director",
  "hr",
  "operations_manager",
];

/** Delete a device and manage attendance API keys. */
export const ATTENDANCE_DEVICE_ADMIN_ROLES: readonly AppRole[] = [
  "super_admin",
  "director",
];

/** Payment accounts and leave-approver changes. finance_admin and hr stay out. */
export const PAYMENT_AND_LEAVE_APPROVER_ROLES: readonly AppRole[] = [
  "super_admin",
  "director",
];

/** Actions that write attendance_register (set clock-out). */
export const ATTENDANCE_REGISTER_ACTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "director",
  "hr",
];

/** Record a full day, half day, or absent decision on a late or early-leave row. */
export const ATTENDANCE_EXCEPTION_DECIDE_ROLES: readonly AppRole[] = [
  "super_admin",
  "director",
  "hr",
];

/** Open the attendance exceptions list. Operations manager can view only. */
export const ATTENDANCE_EXCEPTION_VIEW_ROLES: readonly AppRole[] = [
  "super_admin",
  "director",
  "hr",
  "operations_manager",
  "finance_admin",
];

export function canAccessDevicesHub(role: AppRole | null): boolean {
  return roleIn(role, DEVICES_HUB_ROLES);
}

export function canWriteAttendanceDevices(role: string | null | undefined): boolean {
  return (ATTENDANCE_DEVICE_WRITE_ROLES as readonly string[]).includes(role ?? "");
}

export function canAdministerAttendanceDevices(
  role: string | null | undefined,
): boolean {
  return (ATTENDANCE_DEVICE_ADMIN_ROLES as readonly string[]).includes(role ?? "");
}

export function canSetAttendanceClockOut(role: string | null | undefined): boolean {
  return (ATTENDANCE_REGISTER_ACTION_ROLES as readonly string[]).includes(
    role ?? "",
  );
}

export function canDecideAttendanceException(
  role: string | null | undefined,
): boolean {
  return (ATTENDANCE_EXCEPTION_DECIDE_ROLES as readonly string[]).includes(
    role ?? "",
  );
}

export function canViewAttendanceExceptions(
  role: string | null | undefined,
): boolean {
  return (ATTENDANCE_EXCEPTION_VIEW_ROLES as readonly string[]).includes(
    role ?? "",
  );
}

export const POS_SECTION_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "finance_admin",
  "hr",
  "director",
  "sales_rep",
];

/** POS Paystack routes also serve manual-sale collection (includes operations managers). */
export const PRODUCT_SALE_PAYSTACK_ROLES: readonly AppRole[] = [
  ...POS_SECTION_ROLES,
  "operations_manager",
];

/**
 * Resolve a charged Paystack payment that was not recorded as a sale.
 * operations_manager may collect, and may not resolve these rows.
 */
export const PAYSTACK_ATTENTION_RESOLVE_ROLES: readonly AppRole[] = [
  "super_admin",
  "director",
  "finance_admin",
];

export function canResolvePaystackAttention(
  role: string | null | undefined,
): boolean {
  return (PAYSTACK_ATTENTION_RESOLVE_ROLES as readonly string[]).includes(
    role ?? "",
  );
}

/** Credit Notes register (Finance tab + Sales & CRM tab — same page). */
export const CREDIT_NOTES_PAGE_ROLES: readonly AppRole[] = [
  ...FINANCE_SECTION_ROLES,
  "sales_rep",
];

/** Record Refund on a credit note (finance roles only). */
export const CREDIT_NOTES_RECORD_REFUND_ROLES: readonly AppRole[] = [
  ...FINANCE_SECTION_ROLES,
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
  "finance_admin",
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
  finance: ["super_admin", "finance", "finance_admin", "hr", "director"],
  "hr-payroll": ["super_admin", "finance", "finance_admin", "hr", "director"],
  operations: [
    "super_admin",
    "operations_manager",
    "director",
    "supervisor",
    "finance_admin",
  ],
  inventory: [
    "super_admin",
    "operations_manager",
    "director",
    "finance",
    "finance_admin",
  ],
  sales: CRM_FULL_FEATURE_ROLES,
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
  showDirectorScorecard: boolean;
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

/** Directors board (scorecard, dividends, shareholders, settings). */
export function canAccessDirectorsBoard(role: AppRole | null): boolean {
  return roleIn(role, ["director", "super_admin"] as const);
}

/** @deprecated Finance no longer has a Dividends tab — use Directors board. */
export function canAccessDividendsTab(role: AppRole | null): boolean {
  return canAccessDirectorsBoard(role);
}

export function canManageDividends(role: AppRole | null): boolean {
  return canAccessDirectorsBoard(role);
}

export function isFinanceSuppliersPath(pathname: string): boolean {
  return (
    pathname === "/dashboard/finance/suppliers" ||
    pathname.startsWith("/dashboard/finance/suppliers/")
  );
}

/** Inventory-tier roles that reach Suppliers under Finance without full Finance tabs. */
export function isFinanceSuppliersOnlyRole(role: AppRole | null): boolean {
  return (
    roleIn(role, FINANCE_SUPPLIERS_PAGE_ROLES) &&
    !canAccessFinanceSection(role)
  );
}

export function canAccessFinanceSuppliersPage(role: AppRole | null): boolean {
  return roleIn(role, FINANCE_SUPPLIERS_PAGE_ROLES);
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
  return roleIn(role, OPERATIONS_LAYOUT_ROLES);
}

export function isOperationsReadOnlyRole(role: AppRole | null): boolean {
  return role === "finance_admin";
}

export function canEditProcurement(role: AppRole | null): boolean {
  return roleIn(role, PROCUREMENT_EDIT_ROLES);
}

export function canEditInventoryOrProcurement(role: AppRole | null): boolean {
  return canEditInventory(role) || canEditProcurement(role);
}

/** POST/PATCH on suppliers, POs, purchases, internal consumption (not stock adjustments). */
export const INVENTORY_PROCUREMENT_MUTATION_ROLES: readonly AppRole[] = [
  ...INVENTORY_OPERATOR_ROLES,
];

export function canDeleteEmployees(role: AppRole | null): boolean {
  return canEditEmployees(role) && role !== "finance_admin";
}

export function canEditEmployeePayFields(role: AppRole | null): boolean {
  return canEditEmployees(role) && role !== "finance_admin";
}

export function canProvisionLeaveBalancesOnEmployeeCreate(
  role: AppRole | null,
): boolean {
  return roleIn(role, ["super_admin", "finance", "hr", "director"] as const);
}

export function canRecordEmploymentHistory(role: AppRole | null): boolean {
  return role !== null && role !== "finance_admin";
}

export function canUseEmployeeBulkImport(role: AppRole | null): boolean {
  return canAccessEmployeesSection(role) && role !== "finance_admin";
}

export function canStartRotation(role: AppRole | null): boolean {
  return roleIn(role, START_ROTATION_ROLES);
}

/** Self-Service requires a linked `user_accounts.employee_id` (not the client portal role). */
export function canAccessSelfServiceSection(
  role: AppRole | null,
  linkedEmployeeId?: string | null,
): boolean {
  if (!linkedEmployeeId?.trim()) {
    return false;
  }
  if (role === "client") {
    return false;
  }
  return true;
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

export function isCrmSalesRepScopedRole(role: AppRole | null): boolean {
  return role === "sales_rep";
}

export function isCrmPathAllowedForSalesRep(pathname: string): boolean {
  if (pathname === "/dashboard/crm") {
    return true;
  }

  return CRM_SALES_REP_ALLOWED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isCrmNavItemVisibleForRole(
  href: string,
  role: AppRole | null,
): boolean {
  if (!isCrmSalesRepScopedRole(role)) {
    return true;
  }

  if (href.startsWith("/dashboard/crm/email-promotions")) {
    return false;
  }

  return CRM_SALES_REP_NAV_HREFS.some(
    (allowed) => href === allowed || href.startsWith(`${allowed}/`),
  );
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

export function canAccessCreditNotesPage(role: AppRole | null): boolean {
  return roleIn(role, CREDIT_NOTES_PAGE_ROLES);
}

export function canRecordCreditNoteRefund(role: AppRole | null): boolean {
  return roleIn(role, CREDIT_NOTES_RECORD_REFUND_ROLES);
}

export function canEditInventory(role: AppRole | null): boolean {
  return roleIn(role, INVENTORY_OPERATOR_ROLES);
}

export function canAdjustInventoryStock(role: AppRole | null): boolean {
  return roleIn(role, INVENTORY_EDIT_ROLES);
}

/** Set a missing finished-product opening cost. Finance can do this; stock adjustments stay with inventory editors. */
export const FINISHED_PRODUCT_OPENING_COST_ROLES: readonly AppRole[] = [
  "super_admin",
  "director",
  "finance",
  "finance_admin",
];

export function canSetFinishedProductOpeningCost(role: AppRole | null): boolean {
  return roleIn(role, FINISHED_PRODUCT_OPENING_COST_ROLES);
}

export function canConfigureInventoryGoLive(role: AppRole | null): boolean {
  return roleIn(role, INVENTORY_GO_LIVE_ROLES);
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
    role === "finance" ||
    role === "finance_admin";

  const showDirectorScorecard =
    role === "super_admin" || role === "director";

  return {
    showFinancialSummary,
    showFinancialCharts,
    showPayrollPanel,
    showInventoryAlerts,
    showDirectorScorecard,
  };
}

export function getSidebarNavItems(
  role: AppRole | null,
  linkedEmployeeId?: string | null,
): SidebarNavItem[] {
  const items: SidebarNavItem[] = [{ label: "Dashboard", href: "/dashboard" }];

  // POS lives inside Sales & CRM for users who can access that section; only
  // POS-only roles (e.g. sales_rep) still get a standalone sidebar link.
  if (canAccessPosSection(role) && !canAccessCrmSection(role)) {
    items.push({ label: "POS", href: "/dashboard/pos" });
  }

  if (canAccessFinanceSection(role)) {
    items.push({ label: "Finance", href: "/dashboard/finance" });
  } else if (canAccessFinanceSuppliersPage(role)) {
    items.push({ label: "Finance", href: "/dashboard/finance/suppliers" });
  }

  if (canAccessCrmSection(role)) {
    items.push({
      label: "Sales & CRM",
      href: isCrmSalesRepScopedRole(role)
        ? "/dashboard/crm/customers"
        : "/dashboard/crm",
    });
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

  if (canAccessSelfServiceSection(role, linkedEmployeeId)) {
    items.push({ label: "Self-Service", href: "/dashboard/self-service" });
  }

  if (canAccessClientPortalSection(role)) {
    items.push({ label: "Customer Portal", href: "/dashboard/client-portal" });
  }

  if (getAccessibleReportCategoryIds(role).length > 0) {
    items.push({ label: "Reports", href: "/dashboard/reports" });
  }

  if (canAccessDirectorsBoard(role)) {
    items.push({ label: "Directors", href: "/dashboard/directors" });
  }

  if (canAccessDevicesHub(role)) {
    items.push({ label: "Scanners & Devices", href: "/dashboard/devices" });
  }

  if (role === "super_admin" || role === "director") {
    items.push({ label: "Administration", href: "/dashboard/administration" });
  }

  return items;
}

/** Approvers who cannot open HR still need the Leave / Attendance Approvals links. */
export function withApproverInboxNav(
  items: SidebarNavItem[],
  options: {
    showLeaveApprovals?: boolean;
    showAttendanceApprovals?: boolean;
  },
): SidebarNavItem[] {
  if (!options.showLeaveApprovals && !options.showAttendanceApprovals) {
    return items;
  }
  if (items.some((item) => item.href === "/dashboard/hr-payroll")) {
    return items;
  }

  const next = [...items];
  const selfServiceIndex = next.findIndex(
    (item) => item.href === "/dashboard/self-service",
  );
  next.splice(selfServiceIndex >= 0 ? selfServiceIndex : next.length, 0, {
    label: "HR Management",
    href: "/dashboard/hr-payroll",
  });
  return next;
}
