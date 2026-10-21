/**
 * Unit test: site form contract choices derive the customer and anchor project.
 * Usage: npx tsx scripts/test-site-form-contracts.ts
 */
import assert from "node:assert/strict";
import { listSiteFormContractChoices } from "../lib/site-form-contracts";

const choices = listSiteFormContractChoices({
  projects: [
    {
      id: "prj01",
      project_code: "PRJ01",
      project_name: "Central University",
      service_contract_id: "sc-cu",
      contract_type: "contract",
      is_archived: false,
    },
    {
      id: "prj09",
      project_code: "PRJ09",
      project_name: "CU Site Wing",
      service_contract_id: "sc-cu",
      contract_type: "contract",
      is_archived: false,
    },
    {
      id: "prj08",
      project_code: "PRJ08",
      project_name: "Davors Office",
      service_contract_id: null,
      contract_type: "contract",
      is_archived: false,
    },
  ],
  sites: [
    { client_id: "CL-CU", project_code: "PRJ01" },
    { client_id: "CL-DO", project_code: "PRJ08" },
  ],
  serviceContracts: [{ id: "sc-cu", client_id: "CL-CU" }],
});

assert.equal(choices.length, 2);
const university = choices.find((choice) => choice.label === "Central University");
assert(university, "Central University is one contract");
assert.equal(university.clientId, "CL-CU");
assert.equal(university.anchorProjectId, "prj01");
assert.deepEqual(university.projectCodes.sort(), ["PRJ01", "PRJ09"]);
assert.equal(university.dataIssue, null);

const office = choices.find((choice) => choice.label === "Davors Office");
assert(office, "Davors Office is listed without a service contract");
assert.equal(office.clientId, "CL-DO");
assert.equal(office.dataIssue, null);

console.log("site form contract choices ok");
