/**
 * Duplicate contract names are blocked for active rows only.
 * Usage: npx tsx scripts/test-contract-duplicate.ts
 */
import assert from "node:assert/strict";
import {
  duplicateContractNameMessage,
  findActiveContractNameDuplicate,
} from "../app/dashboard/administration/projects-utils";

const contracts = [
  {
    project_code: "PRJ13",
    project_name: "Test Contract K",
    is_archived: false,
  },
  {
    project_code: "PRJ14",
    project_name: "  test contract k  ",
    is_archived: true,
  },
];

const duplicate = findActiveContractNameDuplicate(
  "  Test Contract K ",
  contracts,
);
assert.equal(duplicate?.project_code, "PRJ13");
assert.equal(
  duplicateContractNameMessage("Test Contract K", "PRJ13"),
  "A contract named 'Test Contract K' already exists (PRJ13)",
);

assert.equal(
  findActiveContractNameDuplicate("Test Contract K", contracts, "PRJ13"),
  null,
);
assert.equal(
  findActiveContractNameDuplicate("Other Contract", contracts),
  null,
);
assert.equal(
  findActiveContractNameDuplicate("test contract k", [
    { project_code: "PRJ14", project_name: "Test Contract K", is_archived: true },
  ]),
  null,
);

console.log("contract duplicate tests passed");
