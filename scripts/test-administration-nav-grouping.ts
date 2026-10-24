/**
 * Unit test: Administration sidebar and tab grouping.
 * Usage: npx tsx scripts/test-administration-nav-grouping.ts
 */
import assert from "node:assert/strict";
import { isDirectorAdministrationPath } from "../app/dashboard/administration/administration-access";
import { PAYMENT_AND_LEAVE_APPROVER_ROLES } from "../utils/rbac-access";
import {
  ADMINISTRATION_GROUPS,
  getAdministrationSidebarLinks,
  getMonitoringSupportNavItems,
  getPlatformAdministrationGroups,
  isAdministrationPath,
  isPlatformAdministrationPath,
  MONITORING_SUPPORT_GROUP_ID,
  PLATFORM_SETTINGS_GROUP_ID,
} from "../app/dashboard/administration/administration-nav-config";
import {
  getHrManagementSidebarLinks,
  isHrManagementGroupActive,
  isHrManagementPath,
  LEAVE_APPROVALS_GROUP_ID,
  LEAVE_APPROVALS_HREF,
} from "../app/dashboard/hr-payroll/hr-management-nav-config";

function run() {
  const platform = ADMINISTRATION_GROUPS.find(
    (g) => g.id === PLATFORM_SETTINGS_GROUP_ID,
  );
  const monitoring = ADMINISTRATION_GROUPS.find(
    (g) => g.id === MONITORING_SUPPORT_GROUP_ID,
  );
  assert(platform, "Platform Settings group exists");
  assert(monitoring, "Monitoring & Support group exists");

  assert.deepEqual(
    platform.items.map((i) => i.label),
    ["Tenant Management", "Tier Pricing", "Platform Unit Pricing"],
  );
  assert.deepEqual(
    monitoring.items.map((i) => i.label),
    [
      "System Event Log",
      "User Activity Log",
      "Support Tickets",
      "Platform SMS Usage",
    ],
  );

  assert.deepEqual(
    getMonitoringSupportNavItems(true).map((item) => item.label),
    [
      "System Event Log",
      "User Activity Log",
      "Support Tickets",
      "Platform SMS Usage",
    ],
  );
  assert.deepEqual(getMonitoringSupportNavItems(false), []);

  const financeSettings = ADMINISTRATION_GROUPS.find(
    (g) => g.id === "finance-settings",
  );
  const hrSettings = ADMINISTRATION_GROUPS.find((g) => g.id === "hr-settings");
  assert(financeSettings, "Finance Settings group exists");
  assert(hrSettings, "HR Settings group exists");
  assert(
    financeSettings.items.some((item) => item.href === "/dashboard/administration/approvers"),
    "Approvers lives under Finance Settings",
  );
  assert(
    !hrSettings.items.some((item) => item.href === "/dashboard/administration/approvers"),
    "Approvers removed from HR Settings",
  );
  assert(
    !financeSettings.items.some(
      (item) => item.href === "/dashboard/pos/scanner-setup",
    ),
    "Scanner Setup (POS Devices) removed from Finance Settings",
  );
  assert(
    !ADMINISTRATION_GROUPS.some((group) => group.id === "devices"),
    "Devices is not an Administration nav group",
  );

  const davorsSidebar = getAdministrationSidebarLinks({
    isDavorsPlatformSuperAdmin: true,
  });
  assert.deepEqual(
    davorsSidebar.map((l) => l.label),
    [
      "Finance Settings",
      "HR Settings",
      "Operations Settings",
      "User Accounts",
      "Workspace Settings",
      "Platform Settings",
      "Monitoring & Support",
    ],
  );
  assert.equal(
    davorsSidebar.find((l) => l.groupId === PLATFORM_SETTINGS_GROUP_ID)?.href,
    "/dashboard/administration/tenants",
  );
  assert.equal(
    davorsSidebar.find((l) => l.groupId === MONITORING_SUPPORT_GROUP_ID)?.href,
    "/dashboard/administration/system-events",
  );

  const directorSidebar = getAdministrationSidebarLinks({
    isDavorsPlatformSuperAdmin: true,
    audience: "director",
  });
  assert.deepEqual(
    directorSidebar.map((l) => l.label),
    ["Finance Settings", "HR Settings", "Operations Settings"],
  );

  const tenantSidebar = getAdministrationSidebarLinks({
    isDavorsPlatformSuperAdmin: false,
  });
  assert.deepEqual(
    tenantSidebar.map((l) => l.label),
    [
      "Finance Settings",
      "HR Settings",
      "Operations Settings",
      "User Accounts",
      "Workspace Settings",
    ],
  );

  const hrLinks = getHrManagementSidebarLinks();
  assert.deepEqual(
    hrLinks.map((l) => l.label),
    ["Employees", "Payroll", "HR Operations", "Employee Announcements"],
  );
  assert(!hrLinks.some((l) => l.groupId === LEAVE_APPROVALS_GROUP_ID));
  assert(!hrLinks.some((l) => l.label === "Attendance Approvals"));

  assert(!isHrManagementPath(LEAVE_APPROVALS_HREF));
  assert(!isAdministrationPath(LEAVE_APPROVALS_HREF));
  assert(
    !isHrManagementGroupActive(LEAVE_APPROVALS_HREF, LEAVE_APPROVALS_GROUP_ID),
  );

  const groups = getPlatformAdministrationGroups();
  assert.equal(groups.length, 2);

  const operationsSettings = ADMINISTRATION_GROUPS.find(
    (group) => group.id === "operations-settings",
  );
  assert(operationsSettings, "Operations Settings group exists");
  assert.deepEqual(
    operationsSettings.items.map((item) => item.label),
    [
      "Service Categories",
      "Contract Assignments",
      "Site Assignments",
      "Roster & Shift Settings",
    ],
  );
  assert(isDirectorAdministrationPath("/dashboard/administration"));
  assert(isDirectorAdministrationPath("/dashboard/administration/sites"));
  assert(isDirectorAdministrationPath("/dashboard/administration/expense-categories"));
  assert(!isDirectorAdministrationPath("/dashboard/administration/workspace"));
  assert(!isDirectorAdministrationPath("/dashboard/administration/billing"));
  assert(!isDirectorAdministrationPath("/dashboard/administration/business-units"));
  assert(!isDirectorAdministrationPath("/dashboard/administration/tenants"));
  assert(!isDirectorAdministrationPath("/dashboard/user-accounts"));
  assert(!isDirectorAdministrationPath(""));
  assert(isDirectorAdministrationPath("/dashboard/administration/payment-accounts"));
  assert(isDirectorAdministrationPath("/dashboard/administration/online-payments"));
  assert(isDirectorAdministrationPath("/dashboard/administration/leave-settings"));

  assert(isDirectorAdministrationPath("/dashboard/administration/projects"));
  assert.deepEqual([...PAYMENT_AND_LEAVE_APPROVER_ROLES], [
    "super_admin",
    "director",
  ]);
  assert(!PAYMENT_AND_LEAVE_APPROVER_ROLES.includes("finance_admin"));
  assert(!PAYMENT_AND_LEAVE_APPROVER_ROLES.includes("hr"));

  assert(isPlatformAdministrationPath("/dashboard/administration/tenants"));
  assert(isPlatformAdministrationPath("/dashboard/administration/system-events"));
  assert(!isPlatformAdministrationPath("/dashboard/administration/workspace"));
  assert(!isPlatformAdministrationPath("/dashboard/administration/login-activity"));

  console.log("PASS administration nav grouping");
}

run();
