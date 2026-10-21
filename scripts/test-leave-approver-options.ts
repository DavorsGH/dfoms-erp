/**
 * Leave approver choices come from active employees, not every user account.
 * Usage: npx tsx scripts/test-leave-approver-options.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildLeaveApproverChoices,
  isEligibleLeaveApprover,
  leaveApproverChoiceLabel,
} from "../lib/leave-approver-options";
import { getSidebarNavItems, withApproverInboxNav } from "../utils/rbac-access";

const employees = [
  {
    employee_id: "EMP0002",
    staff_id: "DF0002",
    full_name: "Gifty Andy Avors",
    position: "Director",
    employment_status: "Active",
  },
  {
    employee_id: "EMP0009",
    staff_id: "DF0009",
    full_name: "Ama Cleaner",
    position: "Cleaner",
    employment_status: "Active",
  },
  {
    employee_id: "EMP0003",
    staff_id: "DF0003",
    full_name: "Former Staff",
    position: "Cleaner",
    employment_status: "Inactive",
  },
];

const accounts = [
  {
    auth_uid: "67e20016-8ad6-4234-b2c2-f3a76811c4aa",
    employee_id: "EMP0002",
    is_active: true,
    role: "director",
  },
  {
    auth_uid: "client-portal-uid",
    employee_id: "EMP0009",
    is_active: true,
    role: "client",
  },
  {
    auth_uid: "alias-no-employee",
    employee_id: null,
    is_active: true,
    role: "employee",
  },
];

assert.equal(
  leaveApproverChoiceLabel({
    fullName: "Gifty Andy Avors",
    staffId: "DF0002",
    position: "Director",
    hasStaffLogin: true,
  }),
  "Gifty Andy Avors (DF0002) — Director",
);

const choices = buildLeaveApproverChoices(employees, accounts);
assert.deepEqual(
  choices.map((choice) => choice.label),
  [
    "Ama Cleaner (DF0009) — Cleaner — No login yet",
    "Gifty Andy Avors (DF0002) — Director",
  ],
);
assert.equal(choices[0]?.disabled, true);
assert.equal(choices[0]?.authUid, null);
assert.equal(choices[1]?.disabled, false);
assert.equal(choices[1]?.authUid, "67e20016-8ad6-4234-b2c2-f3a76811c4aa");
assert.equal(
  choices.some((choice) => choice.label.includes("Former Staff")),
  false,
);
assert.equal(
  choices.some((choice) => choice.authUid === "alias-no-employee"),
  false,
);
assert.equal(
  choices.some((choice) => choice.authUid === "client-portal-uid"),
  false,
);

assert.equal(
  isEligibleLeaveApprover({
    account: accounts[0],
    employmentStatus: "Active",
  }),
  true,
);
assert.equal(
  isEligibleLeaveApprover({
    account: accounts[1],
    employmentStatus: "Active",
  }),
  false,
);
assert.equal(
  isEligibleLeaveApprover({
    account: accounts[2],
    employmentStatus: "Active",
  }),
  false,
);
assert.equal(
  isEligibleLeaveApprover({
    account: accounts[0],
    employmentStatus: "Inactive",
  }),
  false,
);

const employeeNav = withApproverInboxNav(getSidebarNavItems("employee", "EMP0009"), {
  showLeaveApprovals: true,
});
const hrIndex = employeeNav.findIndex((item) => item.href === "/dashboard/hr-payroll");
const selfIndex = employeeNav.findIndex(
  (item) => item.href === "/dashboard/self-service",
);
assert.equal(hrIndex >= 0, true);
assert.equal(selfIndex > hrIndex, true);

const directorNav = withApproverInboxNav(getSidebarNavItems("director", null), {
  showLeaveApprovals: true,
});
assert.equal(
  directorNav.filter((item) => item.href === "/dashboard/hr-payroll").length,
  1,
);

const route = readFileSync(
  join(process.cwd(), "app/api/leave/change-approver/route.ts"),
  "utf8",
);
assert.equal(route.includes('requireTenantRoleIn(["super_admin"])'), true);
assert.equal(route.includes("isEligibleLeaveApprover"), true);

const errors = readFileSync(
  join(process.cwd(), "components/feedback/format-action-error.ts"),
  "utf8",
);
assert.equal(
  errors.includes(
    "Couldn't reach the server. Check your connection and try again.",
  ),
  true,
);

console.log("leave approver options tests passed");
