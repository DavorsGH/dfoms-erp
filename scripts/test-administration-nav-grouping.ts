/**
 * Unit test: Davors platform Administration tab grouping.
 * Usage: npx tsx scripts/test-administration-nav-grouping.ts
 */
import assert from "node:assert/strict";
import {
  ADMINISTRATION_GROUPS,
  getAdministrationSidebarLinks,
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

  const workspace = ADMINISTRATION_GROUPS.find(
    (g) => g.id === "workspace-settings",
  );
  assert(workspace?.items.some((i) => i.href === "/dashboard/login-activity"));
  assert(
    !platform.items.some((i) => i.href === "/dashboard/login-activity"),
    "Login Activity stays out of Platform Settings",
  );

  const sidebarLinks = getAdministrationSidebarLinks(true);
  assert.equal(sidebarLinks.length, 5);
  assert.deepEqual(
    sidebarLinks.map((l) => l.label),
    [
      "Finance Settings",
      "HR Settings",
      "Operations Settings",
      "User Accounts",
      "Workspace Settings",
    ],
  );
  assert(
    !sidebarLinks.some(
      (l) =>
        l.groupId === PLATFORM_SETTINGS_GROUP_ID ||
        l.groupId === MONITORING_SUPPORT_GROUP_ID,
    ),
    "Platform admin groups are page tabs only, not sidebar entries",
  );

  const sidebarWithoutPlatform = getAdministrationSidebarLinks(false);
  assert.deepEqual(
    sidebarWithoutPlatform.map((l) => l.groupId),
    sidebarLinks.map((l) => l.groupId),
  );

  const groups = getPlatformAdministrationGroups();
  assert.equal(groups.length, 2);

  assert(isPlatformAdministrationPath("/dashboard/administration/tenants"));
  assert(isPlatformAdministrationPath("/dashboard/administration/system-events"));
  assert(!isPlatformAdministrationPath("/dashboard/administration/workspace"));

  console.log("PASS administration nav grouping");
}

run();
