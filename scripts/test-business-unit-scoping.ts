/**
 * R71 business-unit read-scope helpers (no DB).
 * Usage: npx tsx scripts/test-business-unit-scoping.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyStaffIdScope,
  filterRowsByStaffIdScope,
  filterSitesByScopedProjectIds,
  staffIdInActiveScope,
} from "../app/dashboard/hr-payroll/payroll-bu-scope-utils";
import {
  matchesBusinessUnitScope,
  snapshotBusinessUnitId,
} from "../utils/cart-snapshot-business-unit";
import { announcementAllEmployeesLabel } from "../utils/employee-announcements-audience";
import type { BusinessUnitReadScope } from "../utils/business-unit-view";

const BU_A = "bu-alpha";
const BU_B = "bu-beta";

const staffA = ["STAFF-A1", "STAFF-A2"];
const staffB = ["STAFF-B1"];

const viewAll: BusinessUnitReadScope = { mode: "all" };
const unitA: BusinessUnitReadScope = { mode: "unit", id: BU_A };
const unitB: BusinessUnitReadScope = { mode: "unit", id: BU_B };
const defaultScope: BusinessUnitReadScope = { mode: "default" };

// --- staffIdInActiveScope ---
assert.equal(staffIdInActiveScope("STAFF-A1", null), true);
assert.equal(staffIdInActiveScope("STAFF-B1", null), true);
assert.equal(staffIdInActiveScope("STAFF-A1", staffA), true);
assert.equal(staffIdInActiveScope("STAFF-B1", staffA), false);
assert.equal(staffIdInActiveScope("STAFF-A1", []), false);

// --- applyStaffIdScope empty / null behaviour (conceptual query shim) ---
type QueryShim = {
  staffFilter: string | string[] | null;
  eq(column: string, value: string): QueryShim;
  in(column: string, values: string[]): QueryShim;
};

function makeQuery(): QueryShim {
  return {
    staffFilter: null,
    eq(column, value) {
      if (column === "staff_id") this.staffFilter = value;
      return this;
    },
    in(column, values) {
      if (column === "staff_id") this.staffFilter = values;
      return this;
    },
  };
}

const allQuery = applyStaffIdScope(makeQuery(), null);
assert.equal(allQuery.staffFilter, null);

const emptyQuery = applyStaffIdScope(makeQuery(), []);
assert.equal(emptyQuery.staffFilter, "__no_scoped_staff__");

const unitQuery = applyStaffIdScope(makeQuery(), staffA);
assert.deepEqual(unitQuery.staffFilter, staffA);

// --- filterRowsByStaffIdScope (keeps unmapped null staff) ---
const punchRows = [
  { id: "1", staff_id: "STAFF-A1" },
  { id: "2", staff_id: "STAFF-B1" },
  { id: "3", staff_id: null },
  { id: "4", staff_id: "" },
];

assert.deepEqual(
  filterRowsByStaffIdScope(punchRows, null).map((row) => row.id),
  ["1", "2", "3", "4"],
);
assert.deepEqual(
  filterRowsByStaffIdScope(punchRows, staffA).map((row) => row.id),
  ["1", "3", "4"],
);
assert.deepEqual(
  filterRowsByStaffIdScope(punchRows, staffB).map((row) => row.id),
  ["2", "3", "4"],
);

// --- cart snapshot BU matching ---
assert.equal(
  snapshotBusinessUnitId({ businessUnitId: BU_A }),
  BU_A,
);
assert.equal(snapshotBusinessUnitId({ businessUnitId: "  " }), null);
assert.equal(snapshotBusinessUnitId(null), null);

assert.equal(matchesBusinessUnitScope(BU_A, viewAll), true);
assert.equal(matchesBusinessUnitScope(BU_B, viewAll), true);
assert.equal(matchesBusinessUnitScope(null, viewAll), true);

assert.equal(matchesBusinessUnitScope(BU_A, unitA), true);
assert.equal(matchesBusinessUnitScope(null, unitA), true);
assert.equal(matchesBusinessUnitScope(BU_B, unitA), false);

assert.equal(matchesBusinessUnitScope(null, defaultScope), true);
assert.equal(matchesBusinessUnitScope(BU_A, defaultScope), false);

// view-all returns both cart rows; unit scope returns only in-scope (+ untagged)
const cartRows = [
  { id: "c1", cart_snapshot: { businessUnitId: BU_A } },
  { id: "c2", cart_snapshot: { businessUnitId: BU_B } },
  { id: "c3", cart_snapshot: {} },
];
assert.deepEqual(
  cartRows
    .filter((row) =>
      matchesBusinessUnitScope(
        snapshotBusinessUnitId(row.cart_snapshot),
        viewAll,
      ),
    )
    .map((row) => row.id),
  ["c1", "c2", "c3"],
);
assert.deepEqual(
  cartRows
    .filter((row) =>
      matchesBusinessUnitScope(
        snapshotBusinessUnitId(row.cart_snapshot),
        unitA,
      ),
    )
    .map((row) => row.id),
  ["c1", "c3"],
);

// --- filterSitesByScopedProjectIds ---
const sites = [
  { id: "s1", project_id: "p-a" },
  { id: "s2", project_id: "p-b" },
  { id: "s3", project_id: null },
];
assert.deepEqual(
  filterSitesByScopedProjectIds(sites, null).map((site) => site.id),
  ["s1", "s2", "s3"],
);
assert.deepEqual(
  filterSitesByScopedProjectIds(sites, ["p-a"]).map((site) => site.id),
  ["s1"],
);
assert.deepEqual(
  filterSitesByScopedProjectIds(sites, []).map((site) => site.id),
  [],
);

// --- announcementAllEmployeesLabel ---
assert.equal(
  announcementAllEmployeesLabel({
    viewAllBusinessUnits: true,
    businessUnitName: "Alpha",
  }),
  "All employees",
);
assert.equal(
  announcementAllEmployeesLabel({
    viewAllBusinessUnits: false,
    businessUnitName: null,
  }),
  "All employees",
);
assert.equal(
  announcementAllEmployeesLabel({
    viewAllBusinessUnits: false,
    businessUnitName: "Alpha Ops",
  }),
  "All employees in Alpha Ops",
);

// --- source guards (key call sites must wire scoping) ---
function readSrc(...parts: string[]) {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

const remoteWorkPage = readSrc("app/dashboard/hr-payroll/remote-work/page.tsx");
assert.equal(remoteWorkPage.includes("fetchScopedStaffIds"), true);
assert.equal(remoteWorkPage.includes("applyStaffIdScope"), true);

const exceptionsRoute = readSrc("app/api/attendance/exceptions/route.ts");
assert.equal(exceptionsRoute.includes("fetchScopedStaffIds"), true);
assert.equal(exceptionsRoute.includes("applyStaffIdScope"), true);

const approvalsRoute = readSrc("app/api/attendance/approvals/route.ts");
assert.equal(approvalsRoute.includes("fetchScopedStaffIds"), true);

const salesRegister = readSrc("app/dashboard/crm/sales/sales-register.tsx");
assert.equal(salesRegister.includes("refreshPendingPaystack"), true);
assert.equal(salesRegister.includes("matchesBusinessUnitScope"), true);
assert.equal(salesRegister.includes("snapshotBusinessUnitId"), true);

const devicesTab = readSrc("app/dashboard/devices/attendance-devices-tab.tsx");
assert.equal(devicesTab.includes("useBusinessUnitReadScope"), true);
assert.equal(devicesTab.includes("applyAttendanceDeviceReadScope"), true);
assert.equal(devicesTab.includes("fetchScopedStaffIds"), true);

const reviewRoute = readSrc("app/api/attendance/review/route.ts");
assert.equal(reviewRoute.includes("applyBusinessUnitScope"), true);
assert.equal(reviewRoute.includes("filterRowsByStaffIdScope"), true);

const mapPinRoute = readSrc("app/api/attendance/review/map-pin/route.ts");
assert.equal(mapPinRoute.includes("staffIdInActiveScope"), true);

const attentionRoute = readSrc("app/api/sales/paystack/attention/route.ts");
assert.equal(attentionRoute.includes("matchesBusinessUnitScope"), true);
assert.equal(attentionRoute.includes("snapshotBusinessUnitId"), true);

const payrollProcessingPage = readSrc(
  "app/dashboard/hr-payroll/payroll-processing/page.tsx",
);
assert.equal(payrollProcessingPage.includes("applyEmployeeIdScope"), true);

const payrollHistoryPage = readSrc(
  "app/dashboard/hr-payroll/payroll-history/page.tsx",
);
assert.equal(payrollHistoryPage.includes("fetchScopedEmployeeIds"), true);
assert.equal(payrollHistoryPage.includes("applyEmployeeIdScope"), true);

const projectsPage = readSrc("app/dashboard/administration/projects/page.tsx");
assert.equal(projectsPage.includes("filterSitesByScopedProjectIds"), true);
assert.equal(projectsPage.includes("applyBusinessUnitScope"), true);

const sitesPage = readSrc("app/dashboard/administration/sites/page.tsx");
assert.equal(sitesPage.includes("filterSitesByScopedProjectIds"), true);
assert.equal(sitesPage.includes("applyBusinessUnitScope"), true);

const audienceUtils = readSrc("utils/employee-announcements-audience.ts");
assert.equal(audienceUtils.includes("announcementAllEmployeesLabel"), true);
assert.equal(audienceUtils.includes("applyBusinessUnitScope"), true);

const customersPage = readSrc("app/dashboard/crm/customers/page.tsx");
assert.equal(customersPage.includes("applyBusinessUnitScope"), true);
assert.equal(customersPage.includes("resolveBusinessUnitReadScope"), true);

console.log("business-unit scoping tests passed");
