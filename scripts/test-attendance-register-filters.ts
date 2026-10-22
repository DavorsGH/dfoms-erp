/**
 * Attendance register search, summary, and filter helpers.
 * Usage: npx tsx scripts/test-attendance-register-filters.ts
 */
import assert from "node:assert/strict";
import {
  ATTENDANCE_REGISTER_CSV_HEADERS,
  attendanceEmployeeLabel,
  attendanceFiltersFromSearchParams,
  attendanceFiltersToSearchParams,
  attendanceRegisterStatusLabel,
  buildAttendanceEmployeeFilterOptions,
  buildAttendancePersonMonthSummary,
  classifyAttendanceRowBucket,
  enrichAttendanceRegisterRows,
  filterAttendanceRegisterRows,
  formatAttendanceRegisterHours,
  matchesAttendanceTextQuery,
  sortAttendanceRegisterRows,
  type AttendanceRegisterDisplayRow,
} from "../app/dashboard/hr-payroll/attendance-register-filters";
import type { HrEmployee } from "../app/dashboard/hr-payroll/employee-utils";

assert.equal(formatAttendanceRegisterHours(1.25), "1.25");
assert.equal(formatAttendanceRegisterHours(1.249), "1.25");
assert.equal(formatAttendanceRegisterHours(8.5), "8.5");
assert.equal(formatAttendanceRegisterHours(142), "142");
assert.deepEqual(
  [...ATTENDANCE_REGISTER_CSV_HEADERS],
  [
    "Date",
    "Employee",
    "Staff ID",
    "Employment Type",
    "Contract",
    "Site",
    "Shift",
    "Clock-in",
    "Clock-out",
    "Hours",
    "Exception",
    "Status",
    "Decision",
  ],
);

assert.equal(matchesAttendanceTextQuery("pat", "Patience Mensah", "DF0020"), true);
assert.equal(matchesAttendanceTextQuery("DF0020", "Patience Mensah", "DF0020"), true);
assert.equal(matchesAttendanceTextQuery("df00", "Patience Mensah", "DF0020"), true);
assert.equal(matchesAttendanceTextQuery("xyz", "Patience Mensah", "DF0020"), false);
assert.equal(
  matchesAttendanceTextQuery(
    "10-05",
    "2026-10-05",
    "Patience",
    "DF0020",
    "Morning",
  ),
  true,
);
assert.equal(
  matchesAttendanceTextQuery("morn", "2026-10-05", "Patience", "DF0020", "Morning"),
  true,
);

assert.equal(
  attendanceRegisterStatusLabel({
    attendance_status: "Present",
    source: "remote",
  }),
  "Remote",
);
assert.equal(
  attendanceRegisterStatusLabel({
    attendance_status: "Late",
    source: null,
  }),
  "Late",
);

assert.equal(
  classifyAttendanceRowBucket({
    attendance_status: "Late",
    exception_status: "half_day",
    source: null,
  }),
  "half_day",
);
assert.equal(
  classifyAttendanceRowBucket({
    attendance_status: "Absent",
    exception_status: "absent",
    source: null,
  }),
  "absent",
);
assert.equal(
  classifyAttendanceRowBucket({
    attendance_status: "Present",
    exception_status: "full_day",
    source: "remote",
  }),
  "remote",
);

const employees: HrEmployee[] = [
  {
    employee_id: "E1",
    staff_id: "DF0001",
    full_name: "Active One",
    employment_type: "Full-Time",
    contract_project: "C1",
    employment_status: "Active",
  },
  {
    employee_id: "E2",
    staff_id: "DF0002",
    full_name: "Former Two",
    employment_type: "Full-Time",
    contract_project: "C1",
    employment_status: "Terminated",
  },
];

const options = buildAttendanceEmployeeFilterOptions(employees);
assert.equal(options[0], attendanceEmployeeLabel("Active One", "DF0001"));
assert.equal(options.includes("—— Former staff ——"), true);
assert.ok(options.indexOf("—— Former staff ——") < options.indexOf(
  attendanceEmployeeLabel("Former Two", "DF0002"),
));

const enriched = enrichAttendanceRegisterRows({
  entries: [
    {
      id: "1",
      date: "2026-10-10",
      staff_id: "DF0001",
      employment_type: "Full-Time",
      project_assignment: "C1",
      clock_in: "08:00",
      clock_out: "17:00",
      hours_worked: 8,
      overtime_hours: 0,
      attendance_status: "Present",
      source: "remote",
      scheduled_shift: "Morning",
      exception_status: "none",
      site_code: "SITE-A",
    },
    {
      id: "2",
      date: "2026-10-11",
      staff_id: "DF0001",
      employment_type: "Full-Time",
      project_assignment: "C1",
      clock_in: null,
      clock_out: null,
      hours_worked: 0,
      overtime_hours: 0,
      attendance_status: "Absent",
      exception_status: "absent",
    },
    {
      id: "3",
      date: "2026-10-09",
      staff_id: "DF0002",
      employment_type: "Full-Time",
      project_assignment: "C1",
      clock_in: "09:00",
      clock_out: "13:00",
      hours_worked: 4,
      overtime_hours: 0,
      attendance_status: "Late",
      exception_status: "half_day",
    },
  ],
  employeesByStaffId: new Map(employees.map((row) => [row.staff_id, row])),
  siteNameByCode: new Map([["SITE-A", "Airport"]]),
});

assert.equal(enriched[0]?.statusLabel, "Remote");
assert.equal(enriched[0]?.siteLabel, "Airport");
assert.equal(enriched[2]?.isFormerStaff, true);

const filtered = filterAttendanceRegisterRows(enriched, {
  search: "active",
  employee: null,
  contract: null,
  site: null,
  shift: null,
  employmentType: null,
  status: null,
  decision: null,
  dateRange: null,
});
assert.equal(filtered.length, 2);
assert.ok(filtered.every((row) => row.staff_id === "DF0001"));

const sorted = sortAttendanceRegisterRows(enriched, null);
assert.deepEqual(
  sorted.map((row) => row.date),
  ["2026-10-11", "2026-10-10", "2026-10-09"],
);

const summary = buildAttendancePersonMonthSummary(
  filtered as AttendanceRegisterDisplayRow[],
  2026,
  10,
);
assert.ok(summary);
assert.equal(summary!.present, 0);
assert.equal(summary!.remote, 1);
assert.equal(summary!.absent, 1);
assert.equal(summary!.hours, 8);
assert.match(summary!.summaryLine, /Active One — October 2026/);
assert.match(summary!.summaryLine, /8 hours/);

const fractional = buildAttendancePersonMonthSummary(
  [
    {
      ...enriched[0]!,
      hours_worked: 1.25,
      source: null,
      attendance_status: "Present",
      exception_status: "none",
      statusLabel: "Present",
    },
  ] as AttendanceRegisterDisplayRow[],
  2026,
  10,
);
assert.ok(fractional);
assert.match(fractional!.summaryLine, /1\.25 hours/);

const params = attendanceFiltersToSearchParams(
  2026,
  10,
  {
    search: "pat",
    employee: new Set([attendanceEmployeeLabel("Active One", "DF0001")]),
    contract: null,
    site: null,
    shift: null,
    employmentType: null,
    status: new Set(["Remote"]),
    decision: null,
    dateRange: { from: "2026-10-01", to: "2026-10-15" },
  },
  { columnId: "employee", direction: "asc", valueType: "text" },
);
assert.equal(params.get("year"), "2026");
assert.equal(params.get("month"), "10");
assert.equal(params.get("q"), "pat");
assert.equal(params.get("status"), "Remote");
assert.equal(params.get("dateFrom"), "2026-10-01");

const parsed = attendanceFiltersFromSearchParams(params);
assert.equal(parsed.year, 2026);
assert.equal(parsed.month, 10);
assert.equal(parsed.filters.search, "pat");
assert.equal(parsed.filters.status?.has("Remote"), true);
assert.equal(parsed.sort?.columnId, "employee");

console.log("attendance register filters tests passed");
