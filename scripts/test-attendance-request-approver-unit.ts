/**
 * Attendance request approver rule.
 * Usage: npx tsx scripts/test-attendance-request-approver-unit.ts
 */
import { decideAttendanceRequest } from "../lib/attendance-requests/rules";
import { assert } from "./lib/env";

const leaveApprover = {
  approverAuthUid: "leave-approver",
  approverRole: "hr",
  approverStaffId: "STAFF-HR",
};

const noApprover = {
  approverAuthUid: null,
  approverRole: null,
  approverStaffId: null,
};

const directorSelf = decideAttendanceRequest({
  actorAuthUid: "director-1",
  actorRole: "director",
  actorStaffId: "STAFF-DIR",
  requestStaffId: "STAFF-DIR",
  approver: leaveApprover,
});
assert(directorSelf.allowed, "director self-approve allowed");
assert(directorSelf.selfApproved, "director self-approve sets self_approved");

const superAdminOther = decideAttendanceRequest({
  actorAuthUid: "super-1",
  actorRole: "super_admin",
  actorStaffId: "STAFF-SA",
  requestStaffId: "STAFF-OTHER",
  approver: noApprover,
});
assert(superAdminOther.allowed, "super_admin approves with no leave approver");
assert(!superAdminOther.selfApproved, "approving someone else is not self-approved");

const financeSelf = decideAttendanceRequest({
  actorAuthUid: "finance-1",
  actorRole: "finance_admin",
  actorStaffId: "STAFF-FIN",
  requestStaffId: "STAFF-FIN",
  approver: leaveApprover,
});
assert(!financeSelf.allowed, "finance_admin self-approve blocked");
assert(!financeSelf.selfApproved, "blocked self-approve does not set the flag");

const leaveOther = decideAttendanceRequest({
  actorAuthUid: "leave-approver",
  actorRole: "hr",
  actorStaffId: "STAFF-HR",
  requestStaffId: "STAFF-OTHER",
  approver: leaveApprover,
});
assert(leaveOther.allowed, "leave approver (non-director) approving someone else allowed");
assert(!leaveOther.selfApproved, "leave approver deciding someone else is not self-approved");

const leaveOwn = decideAttendanceRequest({
  actorAuthUid: "leave-approver",
  actorRole: "hr",
  actorStaffId: "STAFF-HR",
  requestStaffId: "STAFF-HR",
  approver: leaveApprover,
});
assert(!leaveOwn.allowed, "leave approver (non-director) approving own blocked");

const hrOther = decideAttendanceRequest({
  actorAuthUid: "hr-2",
  actorRole: "hr",
  actorStaffId: "STAFF-HR-2",
  requestStaffId: "STAFF-OTHER",
  approver: leaveApprover,
});
assert(!hrOther.allowed, "hr role (not approver, not director) blocked");

console.log("attendance request approver unit tests passed");
