/**
 * R23 attendance modes and remote work arrangements.
 * Usage: npx tsx scripts/test-attendance-mode.ts
 */
import assert from "node:assert/strict";
import {
  ARRANGEMENT_APPROVAL_NOTE,
  EXEMPT_ATTENDANCE_MESSAGE,
  QUICK_REMOTE_APPROVAL_NOTE,
  arrangementCoversDate,
  arrangementFieldIssues,
  arrangementsForTenant,
  attendanceModeToStored,
  canManageRemoteWorkArrangements,
  decideRemoteClock,
  exceptionsApplyToMode,
  findCoveringArrangement,
  hasOpenArrangement,
  isExemptMode,
  isoWeekdayForDate,
  normalizeArrangementReason,
  overlapMessage,
  payrollAbsenceDaysForMode,
  resolveAttendanceMode,
  roleDefaultAttendanceMode,
  roleDefaultOptionLabel,
  validateArrangementOverlap,
  type RemoteWorkArrangement,
} from "../lib/attendance-mode";
import { attendanceScheduleColumns, type ExpectedSchedule } from "../lib/shift-attendance";
import { remoteClockOutPlan } from "../lib/attendance-requests/rules";
import {
  absenceDaysForAttendanceRow,
  countAbsencesForStaff,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

let seq = 0;
function arrangement(
  overrides: Partial<RemoteWorkArrangement> = {},
): RemoteWorkArrangement {
  seq += 1;
  return {
    id: `arr-${seq}`,
    tenant_id: TENANT_A,
    staff_id: "DF0001",
    weekdays: [1, 3],
    start_date: "2026-10-01",
    end_date: "2026-12-31",
    location_note: "Working from home",
    reason: "Remote work arrangement",
    auto_approve: false,
    is_active: true,
    ...overrides,
  };
}

// --- Weekday helper: ISO Mon = 1 … Sun = 7 ---------------------------------
assert.equal(isoWeekdayForDate("2026-10-19"), 1, "Monday");
assert.equal(isoWeekdayForDate("2026-10-21"), 3, "Wednesday");
assert.equal(isoWeekdayForDate("2026-10-25"), 7, "Sunday is 7, not 0");
assert.equal(isoWeekdayForDate("2026-10-24"), 6, "Saturday");
assert.equal(isoWeekdayForDate("not-a-date"), null);

// --- Role defaults ---------------------------------------------------------
assert.equal(roleDefaultAttendanceMode("super_admin"), "exempt");
assert.equal(roleDefaultAttendanceMode("director"), "exempt");
for (const role of ["hr", "finance", "operations_manager", "finance_admin"]) {
  assert.equal(roleDefaultAttendanceMode(role), "quick_remote", role);
}
for (const role of ["employee", "supervisor", "sales_rep", "client", null, undefined]) {
  assert.equal(roleDefaultAttendanceMode(role), "standard", String(role));
}
assert.equal(roleDefaultOptionLabel("director"), "Role default (Exempt)");
assert.equal(roleDefaultOptionLabel("hr"), "Role default (Quick remote)");
assert.equal(roleDefaultOptionLabel(null), "Role default");

// --- Override beats role default ------------------------------------------
assert.equal(resolveAttendanceMode({ attendance_mode: "standard" }, "director"), "standard");
assert.equal(resolveAttendanceMode({ attendance_mode: "exempt" }, "employee"), "exempt");
assert.equal(resolveAttendanceMode({ attendance_mode: "quick_remote" }, "employee"), "quick_remote");
assert.equal(resolveAttendanceMode({ attendance_mode: null }, "hr"), "quick_remote");
assert.equal(resolveAttendanceMode({}, "super_admin"), "exempt");
assert.equal(resolveAttendanceMode({ attendance_mode: "bogus" }, "hr"), "quick_remote", "invalid → role default");
assert.equal(resolveAttendanceMode({ attendance_mode: "" }, "employee"), "standard");
assert.equal(resolveAttendanceMode(null, "director"), "exempt");
assert.equal(attendanceModeToStored(""), null, "role default saves NULL");
assert.equal(attendanceModeToStored("exempt"), "exempt");
assert.equal(attendanceModeToStored("nonsense"), null);
assert.equal(isExemptMode("exempt"), true);
assert.equal(isExemptMode("standard"), false);
assert.equal(canManageRemoteWorkArrangements("hr"), true);
assert.equal(canManageRemoteWorkArrangements("director"), true);
assert.equal(canManageRemoteWorkArrangements("super_admin"), true);
assert.equal(canManageRemoteWorkArrangements("finance_admin"), false);
assert.equal(canManageRemoteWorkArrangements("employee"), false);

// --- Exempt: no exceptions -------------------------------------------------
const morning: ExpectedSchedule = {
  clientId: "cust-1",
  shift: "Morning",
  dayType: "weekday",
  startTime: "08:00:00",
  endTime: "17:00:00",
  crossesMidnight: false,
  lateGraceMinutes: 30,
  earlyLeaveGraceMinutes: 30,
};
const lateAndEarly = {
  date: "2026-10-21",
  clockIn: "10:00:00",
  clockOut: "14:00:00",
  schedule: morning,
};
const standardColumns = attendanceScheduleColumns(lateAndEarly);
assert.equal(standardColumns?.exception_status, "pending", "standard staff get exceptions");
assert.equal(standardColumns?.attendance_status, "Late");
assert.ok((standardColumns?.late_minutes ?? 0) > 0);
assert.ok((standardColumns?.early_leave_minutes ?? 0) > 0);

const exemptColumns = attendanceScheduleColumns({ ...lateAndEarly, exempt: true });
assert.equal(exemptColumns?.exception_status, "none", "exempt never pending");
assert.equal(exemptColumns?.attendance_status, "Present", "exempt never late");
assert.equal(exemptColumns?.late_minutes, 0);
assert.equal(exemptColumns?.early_leave_minutes, 0);

const exemptNoClockOut = attendanceScheduleColumns({
  date: "2026-10-21",
  clockIn: "10:00:00",
  clockOut: null,
  schedule: morning,
  exempt: true,
});
assert.equal(exemptNoClockOut?.exception_status, "none");
assert.equal(exemptNoClockOut?.late_minutes, 0);
assert.equal(exceptionsApplyToMode("exempt"), false);
assert.equal(exceptionsApplyToMode("quick_remote"), true);
assert.equal(exceptionsApplyToMode("standard"), true);

// Decided exception rows are never rewritten, exempt or not.
assert.equal(
  attendanceScheduleColumns({
    ...lateAndEarly,
    exempt: true,
    existingExceptionStatus: "half_day",
  }),
  null,
  "reviewed exception is left unchanged",
);

// --- Exempt: no payroll absence -------------------------------------------
const absentRows = [
  { staff_id: "DF0001", date: "2026-10-05", attendance_status: "Absent" },
  { staff_id: "DF0001", date: "2026-10-06", attendance_status: "Present", exception_status: "absent" },
  { staff_id: "DF0001", date: "2026-10-07", attendance_status: "Present", exception_status: "half_day" },
];
assert.equal(countAbsencesForStaff(absentRows, "DF0001", 2026, 10), 2.5, "standard staff are deducted");
assert.equal(
  countAbsencesForStaff(absentRows, "DF0001", 2026, 10, [], new Set(["DF0001"])),
  0,
  "exempt staff (set) never deducted",
);
assert.equal(
  countAbsencesForStaff(absentRows, "DF0001", 2026, 10, [], ["DF0001"]),
  0,
  "exempt staff (array) never deducted",
);
assert.equal(
  countAbsencesForStaff(absentRows, "DF0001", 2026, 10, [], new Set(["DF0002"])),
  2.5,
  "another staff member being exempt changes nothing",
);
assert.equal(absenceDaysForAttendanceRow(absentRows[0]), 1);
assert.equal(absenceDaysForAttendanceRow(absentRows[0], "standard"), 1);
assert.equal(absenceDaysForAttendanceRow(absentRows[0], "exempt"), 0);
assert.equal(payrollAbsenceDaysForMode("exempt", 3), 0);
assert.equal(payrollAbsenceDaysForMode("standard", 3), 3);
assert.equal(payrollAbsenceDaysForMode("quick_remote", 1), 1);

// --- Remote clock decisions ------------------------------------------------
const exemptDecision = decideRemoteClock({
  mode: "exempt",
  remoteAttendanceAllowed: true,
  arrangement: arrangement({ auto_approve: true }),
});
assert.equal(exemptDecision.allowed, false);
assert.equal(exemptDecision.allowed === false && exemptDecision.message, EXEMPT_ATTENDANCE_MESSAGE);
assert.equal(EXEMPT_ATTENDANCE_MESSAGE, "Attendance not required for your role.");

const quick = decideRemoteClock({
  mode: "quick_remote",
  remoteAttendanceAllowed: false,
  arrangement: null,
});
assert.equal(quick.allowed && quick.autoApprove, true, "quick_remote auto-approves");
assert.equal(quick.allowed && quick.note, QUICK_REMOTE_APPROVAL_NOTE);

const standardFlag = decideRemoteClock({
  mode: "standard",
  remoteAttendanceAllowed: true,
  arrangement: null,
});
assert.equal(standardFlag.allowed, true);
assert.equal(standardFlag.allowed && standardFlag.autoApprove, false, "standard needs approval");

const standardNoAccess = decideRemoteClock({
  mode: "standard",
  remoteAttendanceAllowed: false,
  arrangement: null,
});
assert.equal(standardNoAccess.allowed, false, "standard without flag or arrangement is blocked");

const needsApprovalArrangement = decideRemoteClock({
  mode: "standard",
  remoteAttendanceAllowed: false,
  arrangement: arrangement({ auto_approve: false }),
});
assert.equal(needsApprovalArrangement.allowed, true, "an arrangement allows remote clock");
assert.equal(
  needsApprovalArrangement.allowed && needsApprovalArrangement.autoApprove,
  false,
  "arrangement without auto_approve still needs approval",
);

const autoArrangement = arrangement({ auto_approve: true, weekdays: [3] });
const autoDecision = decideRemoteClock({
  mode: "standard",
  remoteAttendanceAllowed: false,
  arrangement: findCoveringArrangement([autoArrangement], {
    tenantId: TENANT_A,
    staffId: "DF0001",
    dateIso: "2026-10-21",
  }),
});
assert.equal(autoDecision.allowed && autoDecision.autoApprove, true, "matching auto_approve arrangement approves");
assert.equal(autoDecision.allowed && autoDecision.note, ARRANGEMENT_APPROVAL_NOTE);
assert.equal(ARRANGEMENT_APPROVAL_NOTE, "Approved by your remote work arrangement");

// A different weekday does not apply.
assert.equal(
  findCoveringArrangement([autoArrangement], {
    tenantId: TENANT_A,
    staffId: "DF0001",
    dateIso: "2026-10-22", // Thursday
  }),
  null,
  "different weekday does not apply",
);
const thursdayDecision = decideRemoteClock({
  mode: "standard",
  remoteAttendanceAllowed: false,
  arrangement: findCoveringArrangement([autoArrangement], {
    tenantId: TENANT_A,
    staffId: "DF0001",
    dateIso: "2026-10-22",
  }),
});
assert.equal(thursdayDecision.allowed, false, "no cover and no flag → blocked");

// Clock-out follows the same auto-approve rule.
assert.equal(
  remoteClockOutPlan({ status: "approved", remoteAttendanceAllowed: false, autoApprove: true }),
  "auto_apply",
);
assert.equal(
  remoteClockOutPlan({ status: "approved", remoteAttendanceAllowed: false }),
  "reopen_pending",
);
assert.equal(
  remoteClockOutPlan({ status: "pending", remoteAttendanceAllowed: true, autoApprove: true }),
  "stamp_pending",
);

// --- Coverage: dates, active flag, open end --------------------------------
const windowed = arrangement({ weekdays: [3], start_date: "2026-10-14", end_date: "2026-10-28" });
assert.equal(arrangementCoversDate(windowed, "2026-10-21"), true);
assert.equal(arrangementCoversDate(windowed, "2026-10-14"), true, "start inclusive");
assert.equal(arrangementCoversDate(windowed, "2026-10-28"), true, "end inclusive");
assert.equal(arrangementCoversDate(windowed, "2026-11-04"), false, "after end date");
assert.equal(arrangementCoversDate(windowed, "2026-10-07"), false, "before start date");
assert.equal(arrangementCoversDate({ ...windowed, is_active: false }, "2026-10-21"), false, "inactive");
assert.equal(
  arrangementCoversDate({ ...windowed, end_date: null }, "2027-03-03"),
  true,
  "open-ended",
);
assert.equal(
  hasOpenArrangement([windowed], { tenantId: TENANT_A, staffId: "DF0001", todayIso: "2026-11-30" }),
  false,
  "ended arrangement is not open",
);
assert.equal(
  hasOpenArrangement([windowed], { tenantId: TENANT_A, staffId: "DF0001", todayIso: "2026-10-21" }),
  true,
);

// --- Overlap refused -------------------------------------------------------
const existing = [
  arrangement({ id: "e1", weekdays: [1, 3], start_date: "2026-10-01", end_date: "2026-12-31" }),
];
const candidate = {
  tenant_id: TENANT_A,
  staff_id: "DF0001",
  weekdays: [3, 5],
  start_date: "2026-11-01",
  end_date: null,
  is_active: true,
};
const refused = validateArrangementOverlap(existing, candidate);
assert.equal(refused.ok, false, "shared weekday + overlapping dates is refused");
if (!refused.ok) {
  assert.equal(refused.conflict.id, "e1");
  assert.match(refused.message, /Wed/);
  assert.doesNotMatch(refused.message, /Mon/, "only shared days are named");
  assert.equal(refused.message, overlapMessage(existing[0], candidate));
}
assert.equal(
  validateArrangementOverlap(existing, { ...candidate, weekdays: [2, 4] }).ok,
  true,
  "different weekdays are fine",
);
assert.equal(
  validateArrangementOverlap(existing, { ...candidate, start_date: "2027-01-01" }).ok,
  true,
  "non-overlapping dates are fine",
);
assert.equal(
  validateArrangementOverlap(existing, { ...candidate, is_active: false }).ok,
  true,
  "an inactive candidate never conflicts",
);
assert.equal(
  validateArrangementOverlap(
    [{ ...existing[0], is_active: false }],
    candidate,
  ).ok,
  true,
  "an inactive existing arrangement never conflicts",
);
assert.equal(
  validateArrangementOverlap(existing, { ...candidate, id: "e1" }).ok,
  true,
  "editing a row does not clash with itself",
);
assert.equal(
  validateArrangementOverlap(existing, { ...candidate, staff_id: "DF0002" }).ok,
  true,
  "another staff member is unaffected",
);
assert.equal(
  validateArrangementOverlap(
    [arrangement({ id: "e2", weekdays: [3], start_date: "2026-10-01", end_date: "2026-10-10" })],
    { ...candidate, start_date: "2026-10-10", end_date: "2026-10-20" },
  ).ok,
  false,
  "touching on the end date overlaps (inclusive)",
);
assert.equal(
  validateArrangementOverlap(
    [arrangement({ id: "e3", weekdays: [3], start_date: "2026-10-01", end_date: null })],
    { ...candidate, start_date: "2030-01-01", end_date: null },
  ).ok,
  false,
  "an open-ended arrangement overlaps any later start",
);

// --- Cross-tenant isolation -------------------------------------------------
const tenantARow = arrangement({ id: "ta", tenant_id: TENANT_A, weekdays: [3], auto_approve: false });
const tenantBRow = arrangement({ id: "tb", tenant_id: TENANT_B, weekdays: [3], auto_approve: true });
assert.deepEqual(
  arrangementsForTenant([tenantARow, tenantBRow], TENANT_A).map((row) => row.id),
  ["ta"],
);
assert.equal(
  findCoveringArrangement([tenantBRow], {
    tenantId: TENANT_A,
    staffId: "DF0001",
    dateIso: "2026-10-21",
  }),
  null,
  "another tenant's arrangement never covers",
);
assert.equal(
  findCoveringArrangement([tenantARow, tenantBRow], {
    tenantId: TENANT_A,
    staffId: "DF0001",
    dateIso: "2026-10-21",
  })?.id,
  "ta",
  "tenant A never picks up tenant B's auto_approve row",
);
assert.equal(
  validateArrangementOverlap([tenantBRow], {
    tenant_id: TENANT_A,
    staff_id: "DF0001",
    weekdays: [3],
    start_date: "2026-10-01",
    end_date: null,
    is_active: true,
  }).ok,
  true,
  "overlap check ignores other tenants",
);
assert.equal(
  hasOpenArrangement([tenantBRow], { tenantId: TENANT_A, staffId: "DF0001", todayIso: "2026-10-21" }),
  false,
);

// --- Field validation ------------------------------------------------------
const goodFields = {
  weekdays: [1],
  start_date: "2026-10-01",
  end_date: null,
  location_note: "Working from home",
  reason: "",
};
assert.deepEqual(arrangementFieldIssues(goodFields), []);
assert.equal(arrangementFieldIssues({ ...goodFields, weekdays: [] })[0]?.field, "weekdays");
assert.equal(arrangementFieldIssues({ ...goodFields, weekdays: [0, 8] })[0]?.field, "weekdays");
assert.equal(arrangementFieldIssues({ ...goodFields, start_date: "" })[0]?.field, "start_date");
assert.equal(
  arrangementFieldIssues({ ...goodFields, end_date: "2026-09-30" })[0]?.field,
  "end_date",
  "end before start",
);
assert.equal(arrangementFieldIssues({ ...goodFields, location_note: "   " })[0]?.field, "location_note");
assert.equal(normalizeArrangementReason("  "), "Remote work arrangement", "reason never saved empty");
assert.equal(normalizeArrangementReason(" Caring duties "), "Caring duties");

console.log("test-attendance-mode: all checks passed");
