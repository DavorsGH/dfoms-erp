export type HrManagementNavItem = {
  label: string;
  href: string;
};

export type HrManagementNavGroup = {
  id: string;
  label: string;
  items: readonly HrManagementNavItem[];
};

export const LEAVE_APPROVALS_GROUP_ID = "leave-approvals";
export const LEAVE_APPROVALS_HREF = "/dashboard/leave-approvals";

export const HR_MANAGEMENT_GROUPS: readonly HrManagementNavGroup[] = [
  {
    id: "employees",
    label: "Employees",
    items: [
      { label: "Employee Directory", href: "/dashboard/employees" },
    ],
  },
  {
    id: "payroll",
    label: "Payroll",
    items: [
      {
        label: "Payroll Processing",
        href: "/dashboard/hr-payroll/payroll-processing",
      },
      {
        label: "Payroll History",
        href: "/dashboard/hr-payroll/payroll-history",
      },
      { label: "Payslip", href: "/dashboard/hr-payroll/payslip" },
    ],
  },
  {
    id: "hr-operations",
    label: "HR Operations",
    items: [
      { label: "Attendance", href: "/dashboard/hr-payroll/attendance" },
      { label: "Leave", href: "/dashboard/hr-payroll/leave" },
      {
        label: "Leave Balances",
        href: "/dashboard/hr-payroll/leave-balances",
      },
      { label: "Overtime", href: "/dashboard/hr-payroll/overtime" },
      { label: "Loans", href: "/dashboard/hr-payroll/loans" },
      {
        label: "Disciplinary",
        href: "/dashboard/hr-payroll/disciplinary",
      },
      {
        label: "Exit Management",
        href: "/dashboard/hr-payroll/exit-management",
      },
      {
        label: "Equipment Register",
        href: "/dashboard/hr-payroll/equipment",
      },
      {
        label: "Staff Kit Register",
        href: "/dashboard/hr-payroll/asset-register",
      },
      {
        label: "Staff ID Cards",
        href: "/dashboard/hr-payroll/staff-id-cards",
      },
    ],
  },
  {
    id: LEAVE_APPROVALS_GROUP_ID,
    label: "Leave Approvals",
    items: [{ label: "Leave Approvals", href: LEAVE_APPROVALS_HREF }],
  },
  {
    id: "employee-announcements",
    label: "Employee Announcements",
    items: [
      {
        label: "Employee Announcements",
        href: "/dashboard/hr-payroll/employee-announcements/templates",
      },
    ],
  },
] as const;

export function isHrManagementPath(pathname: string): boolean {
  return (
    pathname.startsWith("/dashboard/hr-payroll") ||
    pathname.startsWith("/dashboard/employees") ||
    pathname.startsWith(LEAVE_APPROVALS_HREF)
  );
}

const EMPLOYEE_ANNOUNCEMENTS_PREFIX =
  "/dashboard/hr-payroll/employee-announcements";

function isHrNavItemActive(pathname: string, href: string): boolean {
  if (pathname === href) {
    return true;
  }

  // Nested Email & Promotions–style section: one HR nav item covers all sub-routes.
  if (
    href.startsWith(EMPLOYEE_ANNOUNCEMENTS_PREFIX) &&
    pathname.startsWith(EMPLOYEE_ANNOUNCEMENTS_PREFIX)
  ) {
    return true;
  }

  return false;
}

export function getActiveHrManagementGroup(
  pathname: string,
): HrManagementNavGroup {
  for (const group of HR_MANAGEMENT_GROUPS) {
    if (group.items.some((item) => isHrNavItemActive(pathname, item.href))) {
      return group;
    }
  }

  if (pathname.startsWith("/dashboard/employees")) {
    return HR_MANAGEMENT_GROUPS[0];
  }

  if (pathname.startsWith(LEAVE_APPROVALS_HREF)) {
    return (
      HR_MANAGEMENT_GROUPS.find(
        (group) => group.id === LEAVE_APPROVALS_GROUP_ID,
      ) ?? HR_MANAGEMENT_GROUPS[0]
    );
  }

  return HR_MANAGEMENT_GROUPS[0];
}

export function getHrManagementGroupDefaultHref(
  group: HrManagementNavGroup,
): string {
  return group.items[0]?.href ?? "/dashboard/employees";
}

export const HR_MANAGEMENT_SIDEBAR_LINKS = HR_MANAGEMENT_GROUPS.map(
  (group) => ({
    label: group.label,
    href: getHrManagementGroupDefaultHref(group),
    groupId: group.id,
  }),
);

export function getHrManagementSidebarLinks(
  options: { showLeaveApprovals?: boolean } = {},
) {
  const { showLeaveApprovals = false } = options;

  return HR_MANAGEMENT_SIDEBAR_LINKS.filter((link) => {
    if (link.groupId === LEAVE_APPROVALS_GROUP_ID) {
      return showLeaveApprovals;
    }

    return true;
  });
}

export function isHrManagementGroupActive(
  pathname: string,
  groupId: string,
): boolean {
  if (groupId === LEAVE_APPROVALS_GROUP_ID) {
    return pathname.startsWith(LEAVE_APPROVALS_HREF);
  }

  const group = HR_MANAGEMENT_GROUPS.find((entry) => entry.id === groupId);
  if (!group) {
    return false;
  }

  return group.items.some((item) => isHrNavItemActive(pathname, item.href));
}
