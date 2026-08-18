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
  LOGIN_ACTIVITY_ADMIN_HREF,
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
    [
      "System Event Log",
      "User Activity Log",
      "Support Tickets",
      "Login Activity",
    ],
  );

  const workspace = ADMINISTRATION_GROUPS.find(
    (g) => g.id === "workspace-settings",
  );
  assert(
    !workspace?.items.some((i) => i.href === LOGIN_ACTIVITY_ADMIN_HREF),
    "Login Activity removed from Workspace Settings sidebar tabs",
  );

  assert.deepEqual(
    getMonitoringSupportNavItems(true).map((item) => item.label),
    [
      "System Event Log",
      "User Activity Log",
      "Support Tickets",
      "Login Activity",
    ],
  );
  assert.deepEqual(
    getMonitoringSupportNavItems(false).map((item) => item.label),
    ["Login Activity"],
  );

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
  assert.equal(tenantSidebar.length, 6);
  assert.equal(tenantSidebar.at(-1)?.label, "Monitoring & Support");
  assert.equal(tenantSidebar.at(-1)?.href, LOGIN_ACTIVITY_ADMIN_HREF);

  const directorSidebar = getAdministrationSidebarLinks({
    isDavorsPlatformSuperAdmin: false,
    showMonitoringSupport: true,
    directorLoginActivityOnly: true,
  });
  assert.deepEqual(directorSidebar, [
    {
      label: "Monitoring & Support",
      href: LOGIN_ACTIVITY_ADMIN_HREF,
      groupId: MONITORING_SUPPORT_GROUP_ID,
    },
  ]);

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
  assert(isPlatformAdministrationPath(LOGIN_ACTIVITY_ADMIN_HREF));
  assert(!isPlatformAdministrationPath("/dashboard/administration/workspace"));

  console.log("PASS administration nav grouping");
}

run();
