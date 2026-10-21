/**
 * My Attendance month layout and remote field checks.
 *   npx tsx scripts/test-my-attendance-view.ts
 */
import assert from "node:assert/strict";
import {
  attendanceContractLabel,
  attendanceDayKind,
  attendanceExceptionLine,
  buildMonthWeeks,
  formatAttendanceClock,
  selectionForMonth,
  weekSummary,
} from "../app/dashboard/self-service/my-attendance-utils";
import {
  pastDayFieldIssues,
  preselectRemoteLocation,
  recentCustomLocations,
  remoteClockOutPlan,
  remoteNoteIssues,
} from "../lib/attendance-requests/rules";

const projects = [
  { project_code: "PRJ01", project_name: "Central University" },
  { project_code: "PRJ11", project_name: "Basement" },
  { project_code: "PRJ09", project_name: "Students Centre [Plaza]" },
];

assert.equal(
  attendanceContractLabel({
    projectAssignment: "Field Manager",
    employeeContract: "PRJ01",
    projects,
  }),
  "Central University / PRJ01",
);

assert.equal(
  attendanceContractLabel({
    projectAssignment: "Basement",
    employeeContract: "PRJ01",
    projects,
  }),
  "Basement / PRJ11",
);

assert.equal(
  attendanceContractLabel({
    projectAssignment: "BASement",
    employeeContract: "PRJ01",
    projects,
  }),
  "Basement / PRJ11",
);

assert.equal(
  attendanceContractLabel({
    projectAssignment: "PRJ09",
    employeeContract: "PRJ01",
    projects,
  }),
  "Students Centre [Plaza] / PRJ09",
);

assert.equal(
  attendanceContractLabel({
    projectAssignment: "Field Manager",
    employeeContract: null,
    projects,
  }),
  "—",
);

assert.equal(formatAttendanceClock("04:00:00"), "04:00");
assert.equal(formatAttendanceClock("15:30:00"), "15:30");
assert.equal(formatAttendanceClock(null), "—");

assert.equal(
  attendanceDayKind({ attendance_status: "Present", exception_status: "half_day" }),
  "half_day",
);
assert.equal(
  attendanceDayKind({ attendance_status: "Holiday", exception_status: "none" }),
  "leave",
);
assert.equal(
  attendanceDayKind({ attendance_status: "Present", exception_status: "absent" }),
  "absent",
);

assert.equal(
  attendanceExceptionLine({
    late_minutes: 45,
    early_leave_minutes: 0,
    exception_status: "half_day",
  }),
  "Late 45m · Half day",
);

const july = buildMonthWeeks({ year: 2026, month: 7 });
assert.equal(july[0]?.label, "Week 1 · 1–5 Jul");
assert.equal(july[1]?.label, "Week 2 · 6–12 Jul");
assert.equal(
  weekSummary(["present", "present", "late", "absent", "leave", "empty"]),
  "2 present · 1 late · 1 absent · 1 holiday",
);

const now = new Date("2026-10-20T12:00:00Z");
assert.deepEqual(remoteNoteIssues("", "Home"), [
  { field: "location_note", message: "Location note is required." },
]);
assert.equal(remoteNoteIssues("  ", "  ")[0]?.field, "location_note");
assert.equal(remoteNoteIssues("Office", "").length, 0,);
assert.equal(
  remoteNoteIssues("Working from home", "x".repeat(501))[0]?.field,
  "reason",
);
assert.deepEqual(
  recentCustomLocations([
    "Working from home",
    "Site gate",
    "site gate",
    "Warehouse B",
    "Head office",
    "Annex",
    "Old yard",
  ]),
  ["Site gate", "Warehouse B", "Annex"],
);
assert.deepEqual(preselectRemoteLocation("Head office"), {
  choice: "Head office",
  other: "",
});
assert.equal(preselectRemoteLocation("Site gate").choice, "Site gate");
assert.equal(
  remoteClockOutPlan({ status: "pending", remoteAttendanceAllowed: true }),
  "stamp_pending",
);
assert.equal(
  remoteClockOutPlan({ status: "approved", remoteAttendanceAllowed: true }),
  "auto_apply",
);
assert.equal(
  remoteClockOutPlan({ status: "approved", remoteAttendanceAllowed: false }),
  "reopen_pending",
);
assert.equal(
  selectionForMonth({ year: 2026, month: 10 }, "2026-10-20", ["2026-10-01"]),
  "2026-10-20",
);
assert.equal(
  selectionForMonth({ year: 2026, month: 7 }, "2026-10-20", [
    "2026-07-09",
    "2026-07-02",
  ]),
  "2026-07-02",
);
assert.equal(
  selectionForMonth({ year: 2026, month: 8 }, "2026-10-20", []),
  "2026-08-01",
);

const missingTimes = pastDayFieldIssues({
  workDate: "",
  clockIn: "",
  clockOut: "",
  now,
});
assert.deepEqual(
  missingTimes.map((issue) => issue.field),
  ["work_date", "clock_in", "clock_out"],
);

assert.equal(
  pastDayFieldIssues({
    workDate: "2026-10-20",
    clockIn: "16:00",
    clockOut: "15:00",
    now,
  })[0]?.message,
  "Clock-out must be after clock-in.",
);

assert.match(
  pastDayFieldIssues({
    workDate: "2026-08-01",
    clockIn: "08:00",
    clockOut: "16:00",
    now,
  })[0]?.message ?? "",
  /31 days/,
);

assert.equal(
  pastDayFieldIssues({
    workDate: "2026-10-01",
    clockIn: "08:00",
    clockOut: "16:00",
    now,
  }).length,
  0,
);

console.log("my attendance view tests passed");
