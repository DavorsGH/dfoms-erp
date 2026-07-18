export type HrManagementNavItem = {
  label: string;
  href: string;
};

export type HrManagementNavGroup = {
  id: string;
  label: string;
  items: readonly HrManagementNavItem[];
};

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
        label: "Staff ID Cards",
        href: "/dashboard/hr-payroll/staff-id-cards",
      },
    ],
  },
] as const;

export function isHrManagementPath(pathname: string): boolean {
  return (
    pathname.startsWith("/dashboard/hr-payroll") ||
    pathname.startsWith("/dashboard/employees")
  );
}

function isHrNavItemActive(pathname: string, href: string): boolean {
  return pathname === href;
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

export function isHrManagementGroupActive(
  pathname: string,
  groupId: string,
): boolean {
  const group = HR_MANAGEMENT_GROUPS.find((entry) => entry.id === groupId);
  if (!group) {
    return false;
  }

  return group.items.some((item) => pathname === item.href);
}
