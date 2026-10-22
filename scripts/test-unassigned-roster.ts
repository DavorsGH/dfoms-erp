/**
 * New hires stay Unassigned until Duty Roster assigns a site.
 * A contract-group change clears the site. Archived projects stay out of
 * the employee Contract dropdown.
 * Run: npx tsx scripts/test-unassigned-roster.ts
 */
import assert from "node:assert/strict";
import {
  buildDutyRosterViewModel,
  listUnassignedRosterEmployees,
  UNASSIGNED_ROSTER_FACILITY_NAME,
  type DutyRosterEmployee,
  type DutyRosterProject,
  type DutyRosterSite,
} from "../app/dashboard/operations/duty-roster-utils";
import type { RosterConfigRecord } from "../app/dashboard/operations/roster-config-utils";
import {
  buildRosterSiteAssignment,
  listRotationPlanEmployees,
} from "../app/dashboard/operations/rotation-plan";
import {
  contractChangeClearsSite,
  contractLabelForStoredProject,
  listContractChoices,
} from "../lib/employee-contract-site";

const CU = "72736a11-e690-4d3f-a618-2598a96ca051";

function project(
  id: string,
  code: string,
  name: string,
  serviceContractId: string | null,
  archived = false,
): DutyRosterProject {
  return {
    id,
    project_code: code,
    project_name: name,
    service_contract_id: serviceContractId,
    required_staff: null,
    is_archived: archived,
    contract_type: "contract",
  };
}

const projects: DutyRosterProject[] = [
  project("p01", "PRJ01", "Central University", CU),
  project("p10", "PRJ10", "Trinity Hall", CU),
  project("p08", "PRJ08", "Davors Office", null),
  project("p99", "PRJ99", "Archived Fumigation", null, true),
];

function site(
  code: string,
  name: string,
  clientId: string,
  projectId: string,
  projectCode: string,
): DutyRosterSite {
  return {
    site_code: code,
    site_name: name,
    client_id: clientId,
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
  site("SI-003", "Trinity Hall", "CL-CU", "p01", "PRJ01"),
  site("SI-005", "Davors Office", "CL-DO", "p08", "PRJ08"),
  site("SI-099", "Old job", "CL-OLD", "p99", "PRJ99"),
];

const config: RosterConfigRecord = {
  id: "cfg",
  client_id: "CL-CU",
  cycle_start_date: "2026-10-01",
  cycle_length_days: 28,
  morning_time: "06:00",
  afternoon_time: "14:00",
  supervisor_time: null,
};

function person(
  id: string,
  contract: string,
  siteCode: string | null,
): DutyRosterEmployee {
  return {
    employee_id: id,
    staff_id: id,
    full_name: id,
    position: "Cleaner",
    shift: "Morning",
    contract_project: contract,
    assigned_site_id: siteCode,
    employment_status: "Active",
  };
}

function countOn(
  clientId: string,
  employees: DutyRosterEmployee[],
  facilityName: string,
): number {
  const view = buildDutyRosterViewModel({
    clientId,
    clientName: clientId,
    config: { ...config, client_id: clientId },
    employees,
    projects,
    sites,
    history: [],
    referenceDate: new Date("2026-10-20T12:00:00Z"),
  });
  return (
    view.rows.find((row) => row.facilityName === facilityName)?.totalStaff ?? 0
  );
}

const hire = person("ST-NEW", "PRJ01", null);
assert.equal(countOn("CL-CU", [hire], "Trinity Hall"), 0);
assert.equal(countOn("CL-CU", [hire], UNASSIGNED_ROSTER_FACILITY_NAME), 1);
assert.equal(
  listUnassignedRosterEmployees({
    clientId: "CL-CU",
    employees: [hire],
    projects,
    sites,
  }).length,
  1,
);
const plan = listRotationPlanEmployees({
  clientId: "CL-CU",
  employees: [hire],
  projects,
  sites,
});
assert.equal(plan.length, 1);
assert.equal(plan[0]?.currentSiteCode, null);

const assignment = buildRosterSiteAssignment({
  employee: hire,
  siteCode: "SI-003",
  rosterNumber: "R0001",
  rotationNumber: 1,
  effectiveDate: "2026-10-20",
  endDate: "2026-10-28",
  generatedBy: "HR",
  generatedDate: "2026-10-20",
});
assert.equal(assignment.siteCode, "SI-003");
assert.equal(assignment.history.previous_location, "Unassigned");
assert.equal(assignment.history.new_location, "SI-003");
const assigned = { ...hire, assigned_site_id: assignment.siteCode };
assert.equal(countOn("CL-CU", [assigned], "Trinity Hall"), 1);
assert.equal(countOn("CL-CU", [assigned], UNASSIGNED_ROSTER_FACILITY_NAME), 0);

const cuKey = `contract:${CU}`;
assert.equal(
  contractChangeClearsSite({
    originalContractProject: "PRJ10",
    selectedGroupKey: cuKey,
    projects,
  }),
  false,
);
assert.equal(
  contractChangeClearsSite({
    originalContractProject: "PRJ10",
    selectedGroupKey: "project:PRJ08",
    projects,
  }),
  true,
);
const moved = person("ST-MOVE", "PRJ08", null);
assert.equal(countOn("CL-CU", [moved], UNASSIGNED_ROSTER_FACILITY_NAME), 0);
assert.equal(countOn("CL-CU", [moved], "Trinity Hall"), 0);
assert.equal(countOn("CL-DO", [moved], UNASSIGNED_ROSTER_FACILITY_NAME), 1);
assert.equal(countOn("CL-DO", [moved], "Davors Office"), 0);

const choices = listContractChoices(
  projects.map((entry) => ({
    project_code: entry.project_code,
    project_name: entry.project_name,
    service_contract_id: entry.service_contract_id,
    is_archived: entry.is_archived,
    contract_type: entry.contract_type,
  })),
  sites.map((entry) => ({
    site_code: entry.site_code,
    site_name: entry.site_name,
    project_code: entry.project?.project_code ?? null,
  })),
);
assert.equal(
  choices.some((choice) => choice.anchorProjectCode === "PRJ99"),
  false,
);
assert.equal(
  choices.some((choice) => choice.label === "Archived Fumigation"),
  false,
);
assert.equal(
  choices.some((choice) => choice.label === "Central University"),
  true,
);
assert.equal(
  contractLabelForStoredProject(
    "PRJ99",
    projects,
    sites.map((entry) => ({
      site_code: entry.site_code,
      site_name: entry.site_name,
      project_code: entry.project?.project_code ?? null,
    })),
  ),
  "Archived Fumigation",
);

console.log("unassigned roster tests passed");
