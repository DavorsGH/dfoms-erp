/**
 * Unit test: Administration sidebar and tab grouping.
 * Usage: npx tsx scripts/test-administration-nav-grouping.ts
 */
import assert from "node:assert/strict";
import {
  ADMINISTRATION_GROUPS,
  getAdministrationSidebarLinks,
  getMonitoringSupportNavItems,
  getPlatformAdministrationGroups,
  isAdministrationGroupActive,
  isAdministrationPath,
  isPlatformAdministrationPath,
  LEAVE_APPROVALS_GROUP_ID,
  LEAVE_APPROVALS_HREF,
  MONITORING_SUPPORT_GROUP_ID,
  PLATFORM_SETTINGS_GROUP_ID,
} from "../app/dashboard/administration/administration-nav-config";

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
    ["System Event Log", "User Activity Log", "Support Tickets"],
  );

  assert.deepEqual(
    getMonitoringSupportNavItems(true).map((item) => item.label),
    ["System Event Log", "User Activity Log", "Support Tickets"],
  );
  assert.deepEqual(getMonitoringSupportNavItems(false), []);

  const davorsSidebar = getAdministrationSidebarLinks({
    isDavorsPlatformSuperAdmin: true,
    showLeaveApprovals: true,
  });
  assert.deepEqual(
    davorsSidebar.map((l) => l.label),
    [
      "Finance Settings",
      "HR Settings",
      "Operations Settings",
      "User Accounts",
      "Workspace Settings",
      "Leave Approvals",
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

  const tenantSidebar = getAdministrationSidebarLinks({
    isDavorsPlatformSuperAdmin: false,
    showLeaveApprovals: false,
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

  const groups = getPlatformAdministrationGroups();
  assert.equal(groups.length, 2);

  assert(isPlatformAdministrationPath("/dashboard/administration/tenants"));
  assert(isPlatformAdministrationPath("/dashboard/administration/system-events"));
  assert(!isPlatformAdministrationPath("/dashboard/administration/workspace"));
  assert(!isPlatformAdministrationPath("/dashboard/administration/login-activity"));
  assert(isAdministrationPath(LEAVE_APPROVALS_HREF));
  assert(
    isAdministrationGroupActive(LEAVE_APPROVALS_HREF, LEAVE_APPROVALS_GROUP_ID),
  );

  console.log("PASS administration nav grouping");
}

run();
