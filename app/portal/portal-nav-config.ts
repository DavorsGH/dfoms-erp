export type TenantPortalNavItem = {
  id: string;
  label: string;
  href: string;
};

export const TENANT_PORTAL_NAV_ITEMS: readonly TenantPortalNavItem[] = [
  { id: "home", label: "Home", href: "/portal/dashboard" },
  { id: "payments", label: "Payments", href: "/portal/payments" },
  { id: "repairs", label: "Repairs", href: "/portal/repairs" },
  { id: "complaints", label: "Complaints", href: "/portal/complaints" },
  { id: "issues", label: "My Issues", href: "/portal/issues" },
  { id: "account", label: "Account", href: "/portal/account" },
] as const;

export function isTenantPortalPathActive(
  pathname: string,
  href: string,
): boolean {
  if (href === "/portal/dashboard") {
    return pathname === "/portal/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
