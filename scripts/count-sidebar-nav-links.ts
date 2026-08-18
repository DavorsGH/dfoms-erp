/**
 * Count sidebar routes that would prefetch with default Link behavior.
 * Usage: npx tsx scripts/count-sidebar-nav-links.ts
 */
import { getSidebarNavItems } from "../utils/rbac-access";
import { getAdministrationSidebarLinks } from "../app/dashboard/administration/administration-nav-config";
import { HR_MANAGEMENT_SIDEBAR_LINKS } from "../app/dashboard/hr-payroll/hr-management-nav-config";
import { REPORT_SIDEBAR_LINKS } from "../app/dashboard/reports/reports-nav-config";
import { INVENTORY_SIDEBAR_LINKS } from "../app/dashboard/inventory/inventory-nav-config";

function countForRole(role: Parameters<typeof getSidebarNavItems>[0], showPlatform: boolean, showRealEstate: boolean) {
  const top = getSidebarNavItems(role);
  const admin = getAdministrationSidebarLinks({
    isDavorsPlatformSuperAdmin: showPlatform,
    showLeaveApprovals: true,
  });
  const reports = REPORT_SIDEBAR_LINKS.length;
  const hr = HR_MANAGEMENT_SIDEBAR_LINKS.length;
  const inventory = INVENTORY_SIDEBAR_LINKS.length;
  const expandableSubLinks = admin.length + reports + hr + inventory;
  const topLevel = top.length + (showRealEstate ? 1 : 0);
  return {
    role,
    topLevel,
    expandableSubLinks,
    totalWithAllSectionsExpanded: topLevel + expandableSubLinks,
  };
}

console.log("\n=== Sidebar link counts (super_admin, all sections expanded) ===\n");
const davors = countForRole("super_admin", true, true);
console.log(JSON.stringify(davors, null, 2));
console.log(
  `\nWith prefetch={false}: 0 background RSC prefetches from sidebar.`,
);
console.log(
  `With default prefetch: up to ${davors.totalWithAllSectionsExpanded} routes can fire middleware when sections are expanded and links are in viewport.`,
);
