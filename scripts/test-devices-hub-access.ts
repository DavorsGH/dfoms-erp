/**
 * Unit test: top-level Scanners & Devices hub RBAC and sidebar visibility.
 * Usage: npx tsx scripts/test-devices-hub-access.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canAccessDevicesHub,
  DEVICES_HUB_ROLES,
  getSidebarNavItems,
} from "../utils/rbac-access";

function expect(condition: boolean, message: string) {
  assert.ok(condition, message);
}

expect(DEVICES_HUB_ROLES.includes("super_admin"), "super_admin is a hub role");
expect(DEVICES_HUB_ROLES.includes("director"), "director is a hub role");
expect(DEVICES_HUB_ROLES.includes("hr"), "hr is a hub role");
expect(DEVICES_HUB_ROLES.includes("operations_manager"), "operations_manager is a hub role");
expect(DEVICES_HUB_ROLES.includes("finance_admin"), "finance_admin is a hub role");
expect(canAccessDevicesHub("operations_manager"), "operations_manager can access devices hub");
expect(!DEVICES_HUB_ROLES.includes("finance"), "finance is not a hub role");
expect(!DEVICES_HUB_ROLES.includes("sales_rep"), "sales_rep is not a hub role");
expect(!canAccessDevicesHub(null), "unknown role fails closed");
expect(canAccessDevicesHub("director"), "director can access devices hub");
expect(!canAccessDevicesHub("sales_rep"), "sales_rep cannot access devices hub");

const directorSidebar = getSidebarNavItems("director");
expect(
  directorSidebar.some((item) => item.href === "/dashboard/devices"),
  "director sees top-level Scanners & Devices",
);
expect(
  directorSidebar.some((item) => item.href === "/dashboard/administration"),
  "director sees Administration",
);
expect(
  !getSidebarNavItems("finance_admin").some(
    (item) => item.href === "/dashboard/administration",
  ),
  "finance_admin does not see Administration",
);
expect(
  !getSidebarNavItems("hr").some(
    (item) => item.href === "/dashboard/administration",
  ),
  "hr does not see Administration",
);

const superAdminSidebar = getSidebarNavItems("super_admin");
const superAdminLabels = superAdminSidebar.map((item) => item.label);
const devicesIndex = superAdminLabels.indexOf("Scanners & Devices");
const administrationIndex = superAdminLabels.indexOf("Administration");
const directorsIndex = superAdminLabels.indexOf("Directors");
const reportsIndex = superAdminLabels.indexOf("Reports");
expect(devicesIndex >= 0, "super_admin sees Scanners & Devices");
expect(administrationIndex >= 0, "super_admin sees Administration");
expect(devicesIndex === administrationIndex - 1, "Scanners & Devices sits directly above Administration");
expect(directorsIndex === devicesIndex - 1, "Directors sits directly above Scanners & Devices");
expect(reportsIndex === directorsIndex - 1, "Reports sits directly above Directors");

const salesRepSidebar = getSidebarNavItems("sales_rep");
expect(
  getSidebarNavItems("operations_manager").some(
    (item) => item.href === "/dashboard/devices",
  ),
  "operations_manager sees Scanners & Devices",
);
expect(
  !salesRepSidebar.some((item) => item.href === "/dashboard/devices"),
  "sales_rep does not see Scanners & Devices",
);
expect(
  !salesRepSidebar.some((item) => item.href === "/dashboard/administration"),
  "sales_rep does not see Administration",
);

const layoutSource = readFileSync(
  join(process.cwd(), "app/dashboard/devices/layout.tsx"),
  "utf8",
);
expect(
  layoutSource.includes('title: "Scanners & Devices"'),
  "devices layout title is Scanners & Devices",
);
const hubSource = readFileSync(
  join(process.cwd(), "app/dashboard/devices/devices-hub-client.tsx"),
  "utf8",
);
expect(
  hubSource.includes("Scanners & Devices"),
  "devices page heading is Scanners & Devices",
);
expect(
  hubSource.includes('label: "Attendance Devices"'),
  "Attendance Devices tab label is unchanged",
);
expect(
  superAdminLabels.includes("Directors"),
  "Directors label is unchanged",
);
expect(
  layoutSource.includes('redirect("/dashboard")'),
  "devices layout redirects everyone else to /dashboard",
);

const crmNavSource = readFileSync(
  join(process.cwd(), "app/dashboard/crm/crm-nav.tsx"),
  "utf8",
);
expect(
  crmNavSource.includes("/dashboard/pos/scanner-setup"),
  "Sales & CRM keeps Scanner Setup for POS roles",
);

const adminNavSource = readFileSync(
  join(process.cwd(), "app/dashboard/administration/administration-nav-config.ts"),
  "utf8",
);
expect(
  !adminNavSource.includes("Scanner Setup (POS Devices)"),
  "Finance Settings no longer has Scanner Setup (POS Devices)",
);
expect(
  !adminNavSource.includes("/dashboard/administration/devices"),
  "Devices is not an Administration route",
);

console.log("PASS devices hub access");
