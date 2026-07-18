export type AdministrationNavItem = {
  label: string;
  href: string;
};

export type AdministrationNavGroup = {
  id: string;
  label: string;
  items: readonly AdministrationNavItem[];
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
        label: "Asset Categories",
        href: "/dashboard/administration/asset-categories",
      },
      {
        label: "Depreciation Methods",
        href: "/dashboard/administration/depreciation-methods",
      },
    ],
  },
  {
    id: "hr-settings",
    label: "HR Settings",
    items: [
      {
        label: "Salary Rates",
        href: "/dashboard/administration/salary-rates",
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
] as const;

export function isAdministrationPath(pathname: string): boolean {
  return (
    pathname.startsWith("/dashboard/administration") ||
    pathname.startsWith("/dashboard/user-accounts")
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

export const ADMINISTRATION_SIDEBAR_LINKS = ADMINISTRATION_GROUPS.map(
  (group) => ({
    label: group.label,
    href: getAdministrationGroupDefaultHref(group),
    groupId: group.id,
  }),
);

export function isAdministrationGroupActive(
  pathname: string,
  groupId: string,
): boolean {
  const group = ADMINISTRATION_GROUPS.find((entry) => entry.id === groupId);
  if (!group) {
    return false;
  }

  return group.items.some((item) => pathname === item.href);
}
