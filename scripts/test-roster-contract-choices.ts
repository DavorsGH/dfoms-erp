/**
 * Duty Roster lists contracts that have sites, and opens the customer id
 * those sites already use.
 * Run: npx tsx scripts/test-roster-contract-choices.ts
 */
import assert from "node:assert/strict";
import { getContractProjectCodeForClient } from "../app/dashboard/operations/duty-roster-utils";
import type { DutyRosterProject, DutyRosterSite } from "../app/dashboard/operations/duty-roster-utils";
import {
  defaultRosterContractKey,
  listRosterContractChoices,
} from "../lib/roster-contract-choices";

const CU = "72736a11-e690-4d3f-a618-2598a96ca051";

function project(
  code: string,
  name: string,
  serviceContractId: string | null,
  options?: { archived?: boolean; contractType?: string },
): DutyRosterProject {
  return {
    id: code,
    project_code: code,
    project_name: name,
    service_contract_id: serviceContractId,
    required_staff: null,
    is_archived: options?.archived === true,
    contract_type: options?.contractType === "adhoc" ? "adhoc" : "contract",
  };
}

const projects: DutyRosterProject[] = [
  project("PRJ01", "Central University", CU),
  project("PRJ10", "Trinity Hall", CU),
  project("PRJ08", "Davors Office", null),
  project("PRJ13", "University of Ghana Medical Center", null),
  project("PRJ05", "Fumigation", null, { contractType: "adhoc" }),
  project("PRJ99", "Archived Wing", null, { archived: true }),
];

function site(
  code: string,
  clientId: string | null,
  projectCode: string,
): DutyRosterSite {
  return {
    site_code: code,
    site_name: code,
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
    project_id: projectCode,
    project: { id: projectCode, project_code: projectCode, project_name: code },
  };
}

const sites: DutyRosterSite[] = [
  site("SI-003", "CL-CU", "PRJ01"),
  site("SI-001", "CL-CU", "PRJ01"),
  site("SI-005", "CL-DO", "PRJ08"),
  site("SI-099", "CL-OLD", "PRJ99"),
];

const choices = listRosterContractChoices({
  projects,
  sites: sites.map((entry) => ({
    client_id: entry.client_id,
    project_code: entry.project?.project_code ?? null,
  })),
  employees: [
    {
      contract_project: "PRJ10",
      employment_status: "Active",
    },
    {
      contract_project: "PRJ08",
      employment_status: "Inactive",
    },
  ],
});

const central = choices.find((choice) => choice.label === "Central University");
const office = choices.find((choice) => choice.label === "Davors Office");
assert.ok(central);
assert.equal(central.clientId, "CL-CU");
assert.equal(
  getContractProjectCodeForClient(sites, projects, central.clientId ?? ""),
  "PRJ01",
);
assert.ok(office);
assert.equal(office.clientId, "CL-DO");
assert.equal(
  choices.some(
    (choice) => choice.clientId === "CL-CRM" || choice.label === "Walk-in Shop",
  ),
  false,
);
assert.equal(
  choices.some((choice) => choice.label === "University of Ghana Medical Center"),
  false,
);
assert.equal(
  choices.some((choice) => choice.label === "Fumigation"),
  false,
);
assert.equal(
  choices.some((choice) => choice.label === "Archived Wing"),
  false,
);
assert.equal(defaultRosterContractKey(choices, null), central.groupKey);
assert.equal(defaultRosterContractKey(choices, office.groupKey), office.groupKey);

const mixed = listRosterContractChoices({
  projects: [project("PRJ01", "Central University", CU)],
  sites: [
    { client_id: "CL-CU", project_code: "PRJ01" },
    { client_id: "CL-OTHER", project_code: "PRJ01" },
  ],
  employees: [],
});
assert.equal(mixed.length, 1);
assert.equal(mixed[0]?.clientId, null);
assert.match(mixed[0]?.dataIssue ?? "", /more than one customer/);

console.log("roster contract choice tests passed");
