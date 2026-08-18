/**
 * Unit test: Davors platform Administration tab grouping.
 * Usage: npx tsx scripts/test-administration-nav-grouping.ts
 */
import assert from "node:assert/strict";
import {
  ADMINISTRATION_GROUPS,
  getAdministrationSidebarLinks,
  getMonitoringSupportNavItems,
  getPlatformAdministrationGroups,
  isPlatformAdministrationPath,
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
    showMonitoringSupport: true,
  });
  assert.equal(davorsSidebar.length, 5);
  assert.deepEqual(
    davorsSidebar.map((l) => l.label),
    [
      "Finance Settings",
      "HR Settings",
      "Operations Settings",
      "User Accounts",
      "Workspace Settings",
    ],
  );

  const tenantSidebar = getAdministrationSidebarLinks({
    isDavorsPlatformSuperAdmin: false,
    showMonitoringSupport: true,
  });
  assert.equal(tenantSidebar.length, 5);
  assert(
    !tenantSidebar.some((l) => l.groupId === MONITORING_SUPPORT_GROUP_ID),
    "Tenant sidebar must not show empty Monitoring & Support group",
  );

  assert(
    !davorsSidebar.some(
      (l) =>
        l.groupId === PLATFORM_SETTINGS_GROUP_ID ||
        l.groupId === MONITORING_SUPPORT_GROUP_ID,
    ),
    "Platform admin groups are page tabs only for Davors, not sidebar entries",
  );

  const groups = getPlatformAdministrationGroups();
  assert.equal(groups.length, 2);

  assert(isPlatformAdministrationPath("/dashboard/administration/tenants"));
  assert(isPlatformAdministrationPath("/dashboard/administration/system-events"));
  assert(!isPlatformAdministrationPath("/dashboard/administration/workspace"));
  assert(!isPlatformAdministrationPath("/dashboard/administration/login-activity"));

  console.log("PASS administration nav grouping");
}

run();
