/**
 * Duty roster actual headcount follows assigned_site_id before and after a
 * simulated migration 392, and facility rotation updates the site always.
 * Run: npx tsx scripts/test-contract-site-roster.ts
 */
import assert from "node:assert/strict";
import {
  buildDutyRosterViewModel,
  planFacilityRotation,
  type DutyRosterEmployee,
  type DutyRosterProject,
  type DutyRosterSite,
} from "../app/dashboard/operations/duty-roster-utils";
import type { RosterConfigRecord } from "../app/dashboard/operations/roster-config-utils";
import { contractProjectToPersist } from "../lib/employee-contract-site";

const CU = "72736a11-e690-4d3f-a618-2598a96ca051";

function project(
  id: string,
  code: string,
  name: string,
  required: number | null,
): DutyRosterProject {
  return {
    id,
    project_code: code,
    project_name: name,
    service_contract_id: code === "PRJ08" ? null : CU,
    required_staff: required,
    is_archived: false,
    contract_type: "contract",
  };
}

const projects: DutyRosterProject[] = [
  project("p01", "PRJ01", "Central University", null),
  project("p09", "PRJ09", "Students Centre", 4),
  project("p10", "PRJ10", "Trinity Hall", 4),
  project("p08", "PRJ08", "Davors Office", null),
];

function site(
  code: string,
  name: string,
  projectId: string,
  projectCode: string,
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
    required_staff: 4,
    project_id: projectId,
    project: { id: projectId, project_code: projectCode, project_name: name },
  };
}

const sites: DutyRosterSite[] = [
  site("SI-001", "Students Centre", "p01", "PRJ01"),
  site("SI-003", "Trinity Hall", "p01", "PRJ01"),
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

function actuals(employee: DutyRosterEmployee): Record<string, number> {
  const view = buildDutyRosterViewModel({
    clientId: "CL-001",
    clientName: "Central University",
    config,
    employees: [employee],
    projects,
    sites,
    history: [],
    referenceDate: new Date("2026-10-20T12:00:00Z"),
  });
  return Object.fromEntries(
    view.rows.map((row) => [row.siteCode, row.totalStaff]),
  );
}

function employee(
  contract: string,
  siteCode: string,
): DutyRosterEmployee {
  return {
    employee_id: "EMP-1",
    staff_id: "ST-1",
    full_name: "Ama Mensah",
    position: "Cleaner",
    shift: "Morning",
    contract_project: contract,
    assigned_site_id: siteCode,
    employment_status: "Active",
  };
}

const before = actuals(employee("PRJ10", "SI-003"));
const after = actuals(employee("PRJ01", "SI-003"));
assert.deepEqual(before, after);
assert.equal(before["SI-003"], 1);
assert.equal(before["SI-001"], 0);

const nullSite = actuals({
  ...employee("PRJ10", "SI-003"),
  assigned_site_id: null,
});
assert.equal(nullSite["SI-003"], 0, "a blank site is not counted on a facility");
assert.equal(nullSite[""], 1, "a blank site is counted on the Unassigned line");

const movedBefore = planFacilityRotation({
  contractProject: "PRJ10",
  destinationSiteCode: "SI-001",
  projects,
  sites,
});
assert.equal(movedBefore.assigned_site_id, "SI-001");
assert.equal(movedBefore.contract_project, "PRJ09");
const actualBeforeMove = actuals({
  ...employee("PRJ10", "SI-003"),
  contract_project: movedBefore.contract_project,
  assigned_site_id: movedBefore.assigned_site_id,
});
assert.equal(actualBeforeMove["SI-001"], 1);
assert.equal(actualBeforeMove["SI-003"], 0);

const movedAfter = planFacilityRotation({
  contractProject: "PRJ01",
  destinationSiteCode: "SI-001",
  projects,
  sites,
});
assert.equal(movedAfter.assigned_site_id, "SI-001");
assert.equal(movedAfter.contract_project, "PRJ01");
const actualAfterMove = actuals({
  ...employee("PRJ01", "SI-003"),
  ...movedAfter,
});
assert.equal(actualAfterMove["SI-001"], 1);
assert.equal(actualAfterMove["SI-003"], 0);

const kept = contractProjectToPersist({
  originalContractProject: "PRJ10",
  selectedGroupKey: `contract:${CU}`,
  projects,
});
assert.equal(kept, "PRJ10");

const changed = contractProjectToPersist({
  originalContractProject: "PRJ10",
  selectedGroupKey: "project:PRJ08",
  projects,
});
assert.equal(changed, "PRJ08");

console.log("contract-site roster tests passed");
