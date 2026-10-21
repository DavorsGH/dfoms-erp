/** Pages a director may open under Administration. Everything else stays super_admin. */
export const DIRECTOR_ADMINISTRATION_PREFIXES = [
  "/dashboard/administration/expense-categories",
  "/dashboard/administration/expense-subcategories",
  "/dashboard/administration/payment-methods",
  "/dashboard/administration/payment-accounts",
  "/dashboard/administration/online-payments",
  "/dashboard/administration/sales-tax-basis",
  "/dashboard/administration/asset-categories",
  "/dashboard/administration/depreciation-methods",
  "/dashboard/administration/inventory-go-live",
  "/dashboard/administration/approvers",
  "/dashboard/administration/salary-rates",
  "/dashboard/administration/positions",
  "/dashboard/administration/leave-settings",
  "/dashboard/administration/projects",
  "/dashboard/administration/roster-settings",
  "/dashboard/administration/sites",
] as const;

export const DIRECTOR_ADMINISTRATION_EXACT_PATHS = [
  "/dashboard/administration",
] as const;

export function isDirectorAdministrationPath(pathname: string): boolean {
  const path = pathname.trim();
  if (!path) {
    return false;
  }
  if (
    (DIRECTOR_ADMINISTRATION_EXACT_PATHS as readonly string[]).includes(path)
  ) {
    return true;
  }
  return DIRECTOR_ADMINISTRATION_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}
