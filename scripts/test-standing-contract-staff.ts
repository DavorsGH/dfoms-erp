/**
 * Contracts without a rotation list their staff and saved shift times.
 *   npx tsx scripts/test-standing-contract-staff.ts
 */
import type { DutyRosterEmployee, DutyRosterProject } from "../app/dashboard/operations/duty-roster-utils";
import {
  formatAttendanceMode,
  listContractShiftTimeLines,
  listStandingContractStaff,
} from "../app/dashboard/operations/duty-roster-utils";
import { staffGroupKeyForProject } from "../lib/attendance-staff-groups";
import type { ShiftTimeRecord } from "../lib/shift-attendance";

function eq(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const projects = [
  {
    project_code: "OFFICE",
    project_name: "Davors Office",
    service_contract_id: null,
    is_archived: false,
  },
  {
    project_code: "PRJ01",
    project_name: "Central University",
    service_contract_id: "contract-1",
    is_archived: false,
  },
] as DutyRosterProject[];

const officeKey = staffGroupKeyForProject("OFFICE", projects);
if (!officeKey) {
  throw new Error("office group key");
}

function employee(
  id: string,
  project: string,
  status = "Active",
): DutyRosterEmployee {
  return {
    employee_id: id,
    staff_id: id,
    full_name: id,
    position: "Cleaner",
    shift: "Full Day",
    contract_project: project,
    employment_status: status,
    remote_attendance_allowed: id === "DF0002",
  };
}

const staff = listStandingContractStaff({
  groupKey: officeKey,
  projects,
  employees: [
    employee("DF0002", "OFFICE"),
    employee("DF0001", "OFFICE", "Inactive"),
    employee("DF0003", "PRJ01"),
  ],
});
eq(staff.map((row) => row.staff_id).join(","), "DF0002", "office staff only");
eq(formatAttendanceMode(staff[0]?.remote_attendance_allowed), "Remote / hybrid", "remote mode");
eq(formatAttendanceMode(false), "On site", "on site mode");

const times: ShiftTimeRecord[] = [
  {
    client_id: "office-client",
    shift: "Full Day",
    day_type: "weekday",
    start_time: "08:00:00",
    end_time: "17:00:00",
    late_grace_minutes: null,
    early_leave_grace_minutes: null,
  },
  {
    client_id: "office-client",
    shift: "Full Day",
    day_type: "weekend",
    start_time: "09:00:00",
    end_time: "13:00:00",
    late_grace_minutes: null,
    early_leave_grace_minutes: null,
  },
];
const lines = listContractShiftTimeLines("office-client", times);
eq(lines.length, 1, "one shift line");
eq(lines[0]?.primary, "Full Day 8:00 AM – 5:00 PM", "weekday line");
eq(lines[0]?.weekend, "Weekend 9:00 AM – 1:00 PM", "weekend line");
eq(listContractShiftTimeLines("other", times).length, 0, "other contract has no lines");

console.log("standing contract staff tests passed");
