export type AdministrationNavItem = {
  label: string;
  href: string;
};

export type AdministrationNavGroup = {
  id: string;
  label: string;
  items: readonly AdministrationNavItem[];
};

export const PLATFORM_SETTINGS_GROUP_ID = "platform-settings";
export const MONITORING_SUPPORT_GROUP_ID = "monitoring-support";
export const LEAVE_APPROVALS_GROUP_ID = "leave-approvals";
export const LEAVE_APPROVALS_HREF = "/dashboard/leave-approvals";

const PLATFORM_ADMIN_GROUP_IDS: readonly string[] = [
  PLATFORM_SETTINGS_GROUP_ID,
  MONITORING_SUPPORT_GROUP_ID,
];

export type AdministrationSidebarOptions = {
  /** Davors platform super_admin — show Platform Settings + Monitoring & Support. */
  isDavorsPlatformSuperAdmin?: boolean;
  /** Tenant super_admin — reserved for future tenant-scoped monitoring links. */
  showMonitoringSupport?: boolean;
  /** Approver queue for pending leave requests. */
  showLeaveApprovals?: boolean;
};

export const ADMINISTRATION_GROUPS: readonly AdministrationNavGroup[] = [
  {
    id: "finance-settings",
    label: "Finance Settings",
    items: [
      {
        label: "Expense Categories",
        href: "/dashboard/administration/expense-categories",
      },
      {
        label: "Expense Sub-Categories",
        href: "/dashboard/administration/expense-subcategories",
      },
      {
        label: "Payment Methods",
        href: "/dashboard/administration/payment-methods",
      },
      {
        label: "Payment Accounts",
        href: "/dashboard/administration/payment-accounts",
      },
      {
        label: "VAT/WHT Calculation Basis",
        href: "/dashboard/administration/sales-tax-basis",
      },
      {
        label: "Asset Categories",
        href: "/dashboard/administration/asset-categories",
      },
      {
        label: "Depreciation Methods",
        href: "/dashboard/administration/depreciation-methods",
      },
      {
        label: "Inventory Go-Live",
        href: "/dashboard/administration/inventory-go-live",
      },
    ],
  },
  {
    id: "hr-settings",
    label: "HR Settings",
    items: [
      {
        label: "Salary Settings",
        href: "/dashboard/administration/salary-rates",
      },
      {
        label: "Manage Positions",
        href: "/dashboard/administration/positions",
      },
      {
        label: "Approvers",
        href: "/dashboard/administration/approvers",
      },
      {
        label: "Leave Settings",
        href: "/dashboard/administration/leave-settings",
      },
    ],
  },
  {
    id: "operations-settings",
    label: "Operations Settings",
    items: [
      {
        label: "Service Categories",
        href: "/dashboard/administration",
      },
      {
        label: "Contract/Project Assignments",
        href: "/dashboard/administration/projects",
      },
      {
        label: "Roster Settings",
        href: "/dashboard/administration/roster-settings",
      },
    ],
  },
  {
    id: "user-accounts",
    label: "User Accounts",
    items: [
      { label: "User Accounts", href: "/dashboard/user-accounts" },
    ],
  },
  {
    id: "workspace-settings",
    label: "Workspace Settings",
    items: [
      {
        label: "Workspace Settings",
        href: "/dashboard/administration/workspace",
      },
      {
        label: "Billing Settings",
        href: "/dashboard/administration/billing",
      },
      {
        label: "Report a Problem",
        href: "/dashboard/administration/report-a-problem",
      },
    ],
  },
  {
    id: PLATFORM_SETTINGS_GROUP_ID,
    label: "Platform Settings",
    items: [
      {
        label: "Tenant Management",
        href: "/dashboard/administration/tenants",
      },
      {
        label: "Tier Pricing",
        href: "/dashboard/administration/tier-pricing",
      },
      {
        label: "Platform Unit Pricing",
        href: "/dashboard/administration/platform-unit-pricing",
      },
    ],
  },
  {
    id: MONITORING_SUPPORT_GROUP_ID,
    label: "Monitoring & Support",
    items: [
      {
        label: "System Event Log",
        href: "/dashboard/administration/system-events",
      },
      {
        label: "User Activity Log",
        href: "/dashboard/administration/user-activity-log",
      },
      {
        label: "Support Tickets",
        href: "/dashboard/administration/support-tickets",
      },
    ],
  },
] as const;

export function getMonitoringSupportNavItems(
  showPlatformTabs: boolean,
): AdministrationNavItem[] {
  const group = ADMINISTRATION_GROUPS.find(
    (entry) => entry.id === MONITORING_SUPPORT_GROUP_ID,
  );
  if (!group) {
    return [];
  }

  if (!showPlatformTabs) {
    return [];
  }

  return [...group.items];
}

export function isAdministrationPath(pathname: string): boolean {
  return (
    pathname.startsWith("/dashboard/administration") ||
    pathname.startsWith("/dashboard/user-accounts") ||
    pathname.startsWith(LEAVE_APPROVALS_HREF)
  );
}

function isAdministrationNavItemActive(
  pathname: string,
  href: string,
): boolean {
  return pathname === href;
}

export function getActiveAdministrationGroup(
  pathname: string,
): AdministrationNavGroup {
  for (const group of ADMINISTRATION_GROUPS) {
    if (
      group.items.some((item) =>
        isAdministrationNavItemActive(pathname, item.href),
      )
    ) {
      return group;
    }
  }

  if (pathname.startsWith("/dashboard/administration")) {
    return ADMINISTRATION_GROUPS[2];
  }

  if (pathname.startsWith("/dashboard/user-accounts")) {
    return ADMINISTRATION_GROUPS[3];
  }

  return ADMINISTRATION_GROUPS[0];
}

export function getAdministrationGroupDefaultHref(
  group: AdministrationNavGroup,
): string {
  return group.items[0]?.href ?? "/dashboard/administration/expense-categories";
}

export function getAdministrationSidebarLinks(
  options: AdministrationSidebarOptions = {},
) {
  const {
    isDavorsPlatformSuperAdmin = false,
    showLeaveApprovals = false,
  } = options;

  const links: { label: string; href: string; groupId: string }[] = [];

  for (const group of ADMINISTRATION_GROUPS) {
    if (group.id === PLATFORM_SETTINGS_GROUP_ID) {
      if (isDavorsPlatformSuperAdmin) {
        links.push({
          label: group.label,
          href: getAdministrationGroupDefaultHref(group),
          groupId: group.id,
        });
      }
      continue;
    }

    if (group.id === MONITORING_SUPPORT_GROUP_ID) {
      if (
        isDavorsPlatformSuperAdmin &&
        getMonitoringSupportNavItems(true).length > 0
      ) {
        links.push({
          label: group.label,
          href: getAdministrationGroupDefaultHref(group),
          groupId: group.id,
        });
      }
      continue;
    }

    links.push({
      label: group.label,
      href: getAdministrationGroupDefaultHref(group),
      groupId: group.id,
    });

    if (group.id === "workspace-settings" && showLeaveApprovals) {
      links.push({
        label: "Leave Approvals",
        href: LEAVE_APPROVALS_HREF,
        groupId: LEAVE_APPROVALS_GROUP_ID,
      });
    }
  }

  return links;
}

export function isPlatformAdministrationPath(pathname: string): boolean {
  return PLATFORM_ADMIN_GROUP_IDS.some((groupId) =>
    isAdministrationGroupActive(pathname, groupId),
  );
}

export function getPlatformAdministrationGroups(): AdministrationNavGroup[] {
  return ADMINISTRATION_GROUPS.filter((group) =>
    PLATFORM_ADMIN_GROUP_IDS.includes(group.id),
  );
}

export const ADMINISTRATION_SIDEBAR_LINKS = getAdministrationSidebarLinks();

export function isAdministrationGroupActive(
  pathname: string,
  groupId: string,
): boolean {
  if (groupId === LEAVE_APPROVALS_GROUP_ID) {
    return pathname.startsWith(LEAVE_APPROVALS_HREF);
  }

  const group = ADMINISTRATION_GROUPS.find((entry) => entry.id === groupId);
  if (!group) {
    return false;
  }

  return group.items.some((item) => pathname === item.href);
}
