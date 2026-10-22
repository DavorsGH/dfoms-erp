/**
 * Rotation planner: a two-site swap updates assigned sites, roster actuals,
 * and history. Keeping everyone starts the next cycle without moves.
 * Run: npx tsx scripts/test-rotation-plan.ts
 */
import assert from "node:assert/strict";
import {
  buildDutyRosterViewModel,
  calculateRotationDates,
  type DutyRosterEmployee,
  type DutyRosterProject,
  type DutyRosterSite,
} from "../app/dashboard/operations/duty-roster-utils";
import type { RosterConfigRecord } from "../app/dashboard/operations/roster-config-utils";
import {
  buildRotationStartFromPlan,
  keepEveryoneNextSites,
  listRotatableSiteCodes,
  listRotationPlanEmployees,
  listRotationPlanSites,
  rotateAllNextSites,
} from "../app/dashboard/operations/rotation-plan";

const CU = "72736a11-e690-4d3f-a618-2598a96ca051";

function project(
  id: string,
  code: string,
  name: string,
): DutyRosterProject {
  return {
    id,
    project_code: code,
    project_name: name,
    service_contract_id: CU,
    required_staff: null,
    is_archived: false,
    contract_type: "contract",
  };
}

const projects: DutyRosterProject[] = [
  project("p01", "PRJ01", "Central University"),
];

function site(
  code: string,
  name: string,
  requiredStaff: number | null,
): DutyRosterSite {
  return {
    site_code: code,
    site_name: name,
    client_id: "CL-001",
    building: null,
    floor_zone: null,
    area_room: null,
    cleaning_frequency: null,
    risk_level: null,
    est_cleaning_time_min: null,
    assigned_supervisor: null,
    access_instructions: null,
    notes: null,
    required_staff: requiredStaff,
    project_id: "p01",
    project: {
      id: "p01",
      project_code: "PRJ01",
      project_name: "Central University",
    },
  };
}

const sites: DutyRosterSite[] = [
  site("SI-001", "Students Centre", 4),
  site("SI-003", "Trinity Hall", 4),
  site("SI-009", "Closed wing", 0),
];

const config: RosterConfigRecord = {
  id: "cfg",
  client_id: "CL-001",
  cycle_start_date: "2026-10-01",
  cycle_length_days: 28,
  morning_time: "06:00",
  afternoon_time: "14:00",
  supervisor_time: null,
};

function person(
  id: string,
  staffId: string,
  name: string,
  siteCode: string,
): DutyRosterEmployee {
  return {
    employee_id: id,
    staff_id: staffId,
    full_name: name,
    position: "Cleaner",
    shift: "Morning",
    contract_project: "PRJ01",
    assigned_site_id: siteCode,
    employment_status: "Active",
  };
}

const employees = [
  person("EMP-1", "ST-1", "Ama Mensah", "SI-003"),
  person("EMP-2", "ST-2", "Kofi Boateng", "SI-001"),
];

const planSites = listRotationPlanSites("CL-001", sites, projects);
const rotatable = listRotatableSiteCodes(planSites);
assert.deepEqual(rotatable, ["SI-001", "SI-003"]);

const planEmployees = listRotationPlanEmployees({
  clientId: "CL-001",
  employees,
  projects,
  sites,
});
const swapped = rotateAllNextSites(planEmployees, rotatable);
assert.equal(swapped["EMP-1"], "SI-001");
assert.equal(swapped["EMP-2"], "SI-003");

const started = buildRotationStartFromPlan({
  clientId: "CL-001",
  employees,
  projects,
  sites,
  history: [],
  config,
  nextSiteByEmployee: swapped,
  generatedBy: "Tester",
  generatedDate: "2026-10-20",
});

assert.equal(started.updates.length, 2);
const ama = started.updates.find((row) => row.employee_id === "EMP-1");
const kofi = started.updates.find((row) => row.employee_id === "EMP-2");
assert.equal(ama?.assigned_site_id, "SI-001");
assert.equal(kofi?.assigned_site_id, "SI-003");
assert.equal(ama?.contract_project, undefined);
assert.deepEqual(
  started.history.map((row) => row.new_location).sort(),
  ["SI-001", "SI-003"],
);

const movedEmployees = employees.map((employee) => {
  const update = started.updates.find(
    (row) => row.employee_id === employee.employee_id,
  );
  return update
    ? { ...employee, assigned_site_id: update.assigned_site_id }
    : employee;
});
const actuals = buildDutyRosterViewModel({
  clientId: "CL-001",
  clientName: "Central University",
  config,
  employees: movedEmployees,
  projects,
  sites,
  history: [],
  referenceDate: new Date("2026-10-20T12:00:00Z"),
});
const bySite = Object.fromEntries(
  actuals.rows.map((row) => [row.siteCode, row.totalStaff]),
);
assert.equal(bySite["SI-001"], 1);
assert.equal(bySite["SI-003"], 1);

const kept = buildRotationStartFromPlan({
  clientId: "CL-001",
  employees,
  projects,
  sites,
  history: [],
  config,
  nextSiteByEmployee: keepEveryoneNextSites(planEmployees),
  generatedBy: "Tester",
  generatedDate: "2026-10-20",
});
assert.equal(kept.updates.length, 0);
assert.equal(kept.history.length, 0);
assert.equal(kept.nextRotationNumber, 2);
assert.equal(
  kept.nextCycleStartDate,
  calculateRotationDates(config).nextRotationDate,
);

console.log("rotation plan tests passed");
