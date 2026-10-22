/**
 * Active staff options + finance approver routing.
 * Usage: npx tsx scripts/test-active-staff-options.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FINANCE_APPROVER_INACTIVE_BADGE,
  annotateFinanceApprovers,
  buildActiveStaffChoices,
  isEligibleActiveStaffWithLogin,
  routeFinanceApprovals,
} from "../lib/active-staff-options";

const employees = [
  {
    employee_id: "EMP-A",
    staff_id: "DF-A",
    full_name: "Active With Login",
    employment_status: "Active",
  },
  {
    employee_id: "EMP-B",
    staff_id: "DF-B",
    full_name: "Active No Login",
    employment_status: "Active",
  },
  {
    employee_id: "EMP-C",
    staff_id: "DF-C",
    full_name: "Inactive Staff",
    employment_status: "Inactive",
  },
  {
    employee_id: "EMP-D",
    staff_id: "DF-D",
    full_name: "Terminated Staff",
    employment_status: "Terminated",
  },
];

const accounts = [
  {
    auth_uid: "uid-a",
    employee_id: "EMP-A",
    is_active: true,
    role: "finance",
  },
  {
    auth_uid: "uid-c-stale",
    employee_id: "EMP-C",
    is_active: true,
    role: "finance",
  },
];

const choices = buildActiveStaffChoices(employees, accounts);
assert.deepEqual(
  choices.map((choice) => choice.label),
  ["Active With Login (DF-A)"],
);
assert.equal(choices[0]?.selectable, true);
assert.equal(
  choices.some((choice) => choice.label.includes("Active No Login")),
  false,
);
assert.equal(
  choices.some((choice) => choice.label.includes("Inactive")),
  false,
);
assert.equal(
  choices.some((choice) => choice.label.includes("Terminated")),
  false,
);

assert.equal(
  isEligibleActiveStaffWithLogin({
    account: accounts[0],
    employmentStatus: "Active",
  }),
  true,
);
assert.equal(
  isEligibleActiveStaffWithLogin({
    account: null,
    employmentStatus: "Active",
  }),
  false,
);
assert.equal(
  isEligibleActiveStaffWithLogin({
    account: accounts[1],
    employmentStatus: "Inactive",
  }),
  false,
);

const saved = [
  {
    employee_id: "EMP-A",
    full_name: "Active With Login",
    staff_id: "DF-A",
    employment_status: "Active",
  },
  {
    employee_id: "EMP-C",
    full_name: "Inactive Staff",
    staff_id: "DF-C",
    employment_status: "Inactive",
  },
  {
    employee_id: "EMP-B",
    full_name: "Active No Login",
    staff_id: "DF-B",
    employment_status: "Active",
  },
];

const annotated = annotateFinanceApprovers(saved, accounts);
assert.equal(annotated[0]?.isActiveApprover, true);
assert.equal(annotated[1]?.isActiveApprover, false);
assert.equal(annotated[2]?.isActiveApprover, false);

const routed = routeFinanceApprovals(annotated);
assert.deepEqual(
  routed.activeApprovers.map((row) => row.employee_id),
  ["EMP-A"],
);
assert.equal(routed.notifyAdminsDirectors, false);

const onlyInactive = routeFinanceApprovals(
  annotateFinanceApprovers(
    [
      {
        employee_id: "EMP-C",
        full_name: "Inactive Staff",
        staff_id: "DF-C",
        employment_status: "Inactive",
      },
    ],
    accounts,
  ),
);
assert.deepEqual(onlyInactive.activeApprovers, []);
assert.equal(onlyInactive.notifyAdminsDirectors, true);

assert.equal(
  FINANCE_APPROVER_INACTIVE_BADGE,
  "Inactive — replace this approver",
);

const approversUi = readFileSync(
  join(process.cwd(), "app/dashboard/administration/approvers.tsx"),
  "utf8",
);
assert.equal(approversUi.includes("FINANCE_APPROVER_INACTIVE_BADGE"), true);
assert.equal(approversUi.includes("buildActiveStaffChoices"), true);

const leaveLib = readFileSync(
  join(process.cwd(), "lib/leave-approver-options.ts"),
  "utf8",
);
assert.equal(leaveLib.includes("buildActiveStaffChoices"), true);

console.log("active staff options tests passed");
