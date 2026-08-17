/**
 * Verify ERP sidebar top-level order for super_admin with Real Estate enabled.
 * Usage: npx tsx scripts/_verify-sidebar-order.ts
 */
import { getSidebarNavItems } from "../utils/rbac-access";

function buildNavWithRealEstate(role: Parameters<typeof getSidebarNavItems>[0]) {
  const navItems = getSidebarNavItems(role);
  const operationsIndex = navItems.findIndex(
    (item) => item.href === "/dashboard/operations",
  );
  const hrIndex = navItems.findIndex(
    (item) => item.href === "/dashboard/hr-payroll",
  );
  const insertAt =
    hrIndex >= 0
      ? hrIndex + 1
      : operationsIndex >= 0
        ? operationsIndex + 1
        : navItems.length;
  navItems.splice(insertAt, 0, {
    label: "Real Estate",
    href: "/dashboard/real-estate",
  });
  return navItems.map((item) => item.label);
}

const labels = buildNavWithRealEstate("super_admin");
const expected = [
  "Dashboard",
  "Finance",
  "Sales & CRM",
  "Inventory",
  "Operations",
  "HR Management",
  "Real Estate",
  "Self-Service",
  "Reports",
  "Administration",
];

console.log("Actual order:", labels.join(" → "));
console.log("Expected order:", expected.join(" → "));
console.log("Match:", JSON.stringify(labels) === JSON.stringify(expected) ? "PASS" : "FAIL");

if (JSON.stringify(labels) !== JSON.stringify(expected)) {
  process.exit(1);
}
