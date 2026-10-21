/**
 * Expected shift, grace, night-shift minutes, half-day payroll, and lock refusal.
 * Usage: npx tsx scripts/test-shift-attendance.ts
 */
import assert from "node:assert/strict";
import {
  attendanceExceptionBadges,
  attendanceScheduleColumns,
  formatMinuteSpan,
  lateByLabel,
  leftEarlyLabel,
  pendingExceptionLockRefusal,
  resolveExpectedSchedule,
  scheduleDayTypeForDate,
  type ExpectedSchedule,
  type GracePolicy,
  type ShiftTimeRecord,
} from "../lib/shift-attendance";
import {
  calculatePayrollRow,
  countAbsencesForStaff,
  type PayrollEmployeeSource,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import {
  buildExceptionDecisionUpdate,
  decisionRequiredForStatusEdit,
  payrollLockAttendanceMessage,
} from "../lib/attendance-exception-decision";

const projects = [
  {
    project_code: "PRJ01",
    project_name: "Central",
    service_contract_id: null,
    is_archived: false,
  },
];
const sites = [{ client_id: "cust-1", project_code: "PRJ01" }];
const policy: GracePolicy = {
  late_grace_minutes: 30,
  early_leave_grace_minutes: 30,
};

function times(
  shift: string,
  start: string,
  end: string,
  late: number | null = null,
  early: number | null = null,
): ShiftTimeRecord {
  return {
    client_id: "cust-1",
    shift,
    start_time: start,
    end_time: end,
    late_grace_minutes: late,
    early_leave_grace_minutes: early,
  };
}

const shiftTimes = [
  times("Full Day", "08:00", "17:00"),
  times("Morning", "06:00", "14:00"),
  times("Afternoon", "14:00", "22:00"),
  times("Night", "22:00", "06:00"),
  times("Supervisor", "07:00", "16:00", 15, null),
];

function resolve(employee: {
  employee_id?: string;
  position: string | null;
  shift: string | null;
  roster?: { effective_date: string; end_date: string | null; shift: string | null }[];
  rows?: ShiftTimeRecord[];
  grace?: GracePolicy | null;
  date?: string;
  holidays?: string[];
}) {
  return resolveExpectedSchedule({
    employee: {
      employee_id: employee.employee_id ?? "emp-1",
      position: employee.position,
      shift: employee.shift,
      contract_project: "PRJ01",
    },
    date: employee.date ?? "2026-10-20",
    projects,
    sites,
    rosterAssignments: (employee.roster ?? []).map((row) => ({
      employee_id: employee.employee_id ?? "emp-1",
      ...row,
    })),
    shiftTimes: employee.rows ?? shiftTimes,
    gracePolicy: employee.grace === undefined ? policy : employee.grace,
    holidayDates: employee.holidays,
  });
}

const morning = resolve({ position: "Cleaner", shift: "Morning" });
assert.equal(morning?.shift, "Morning");
assert.equal(morning?.lateGraceMinutes, 30);
assert.equal(morning?.crossesMidnight, false);

const supervisor = resolve({
  position: "Site Supervisor",
  shift: "Morning",
});
assert.equal(supervisor?.shift, "Supervisor");
assert.equal(supervisor?.lateGraceMinutes, 15);
assert.equal(supervisor?.earlyLeaveGraceMinutes, 30);

const fullDay = resolve({ position: "Cleaner", shift: "Full Day" });
assert.equal(fullDay?.shift, "Supervisor");

const fullDayTimes = resolve({
  position: "Cleaner",
  shift: "Full Day",
  rows: [times("Full Day", "08:00", "17:00")],
});
assert.equal(fullDayTimes?.shift, "Full Day");

const rotating = resolve({
  position: "Cleaner",
  shift: "Rotating",
  roster: [
    {
      effective_date: "2026-10-01",
      end_date: "2026-10-31",
      shift: "Afternoon",
    },
  ],
});
assert.equal(rotating?.shift, "Afternoon");

assert.equal(
  resolve({ position: "Cleaner", shift: "Rotating" }),
  null,
);
assert.equal(
  resolve({
    position: "Cleaner",
    shift: "Rotating",
    roster: [
      {
        effective_date: "2026-10-01",
        end_date: "2026-10-31",
        shift: "Rotating",
      },
    ],
  }),
  null,
);
assert.equal(
  resolve({
    position: "Cleaner",
    shift: "Night",
    rows: [times("Morning", "06:00", "14:00")],
  }),
  null,
);
assert.equal(
  resolveExpectedSchedule({
    employee: {
      employee_id: "emp-1",
      position: "Cleaner",
      shift: "Morning",
      contract_project: "PRJ01",
    },
    date: "2026-10-20",
    projects,
    sites: [
      { client_id: "cust-1", project_code: "PRJ01" },
      { client_id: "cust-2", project_code: "PRJ01" },
    ],
    rosterAssignments: [],
    shiftTimes,
    gracePolicy: policy,
  }),
  null,
);

const night = resolve({ position: "Guard", shift: "Night" }) as ExpectedSchedule;
assert.equal(night.crossesMidnight, true);

const lateNight = attendanceScheduleColumns({
  date: "2026-10-20",
  clockIn: "22:40:00",
  clockOut: "05:40:00",
  schedule: night,
});
assert.equal(lateNight?.late_minutes, 40);
assert.equal(lateNight?.early_leave_minutes, 0);
assert.equal(lateNight?.attendance_status, "Late");
assert.equal(lateNight?.exception_status, "pending");
assert.equal(lateNight?.scheduled_start, "22:00:00");
assert.equal(lateNight?.scheduled_end, "06:00:00");

const onTime = attendanceScheduleColumns({
  date: "2026-10-20",
  clockIn: "22:20:00",
  clockOut: "06:00:00",
  schedule: night,
});
assert.equal(onTime?.late_minutes, 0);
assert.equal(onTime?.early_leave_minutes, 0);
assert.equal(onTime?.attendance_status, "Present");
assert.equal(onTime?.exception_status, "none");

const leftEarly = attendanceScheduleColumns({
  date: "2026-10-20",
  clockIn: "22:00:00",
  clockOut: "04:40:00",
  schedule: night,
});
assert.equal(leftEarly?.attendance_status, "Present");
assert.equal(leftEarly?.early_leave_minutes, 80);
assert.equal(leftEarly?.exception_status, "pending");
assert.equal(leftEarlyLabel(80), "Left early by 1h 20m");
assert.equal(lateByLabel(25), "Late by 25m");
assert.equal(formatMinuteSpan(60), "1h");

assert.equal(
  attendanceScheduleColumns({
    date: "2026-10-20",
    clockIn: "22:40:00",
    clockOut: "05:00:00",
    schedule: night,
    existingExceptionStatus: "full_day",
  }),
  null,
);
assert.equal(
  attendanceScheduleColumns({
    date: "2026-10-20",
    clockIn: "22:40:00",
    clockOut: null,
    schedule: night,
    existingExceptionStatus: "half_day",
  }),
  null,
);

assert.deepEqual(
  attendanceExceptionBadges({
    late_minutes: 25,
    early_leave_minutes: 80,
    exception_status: "pending",
  }),
  ["Late 25m", "Left early 1h 20m", "Pending"],
);
assert.deepEqual(
  attendanceExceptionBadges({ exception_status: "half_day", late_minutes: 25 }),
  ["Half day"],
);

const dayShift = resolve({ position: "Cleaner", shift: "Morning" }) as ExpectedSchedule;
const withinGrace = attendanceScheduleColumns({
  date: "2026-10-20",
  clockIn: "06:25:00",
  clockOut: "13:40:00",
  schedule: dayShift,
});
assert.equal(withinGrace?.late_minutes, 0);
assert.equal(withinGrace?.early_leave_minutes, 0);

const staff = "DF0020";
const monthRows = [
  {
    staff_id: staff,
    date: "2026-10-03",
    attendance_status: "Present",
    exception_status: "half_day",
  },
  {
    staff_id: staff,
    date: "2026-10-04",
    attendance_status: "Absent",
    exception_status: "absent",
  },
  {
    staff_id: staff,
    date: "2026-10-05",
    attendance_status: "Late",
    exception_status: "full_day",
  },
  {
    staff_id: staff,
    date: "2026-10-06",
    attendance_status: "Late",
    exception_status: "pending",
  },
  {
    staff_id: staff,
    date: "2026-10-07",
    attendance_status: "Present",
    exception_status: "half_day",
  },
];
assert.equal(countAbsencesForStaff(monthRows, staff, 2026, 10), 2);
assert.equal(
  countAbsencesForStaff(
    [
      {
        staff_id: staff,
        date: "2026-10-08",
        attendance_status: "Present",
        exception_status: "half_day",
      },
    ],
    staff,
    2026,
    10,
    [
      {
        staff_id: staff,
        leave_type: "Maternity Leave",
        approval_status: "Approved",
        start_date: "2026-10-01",
        end_date: "2026-10-31",
      },
    ],
  ),
  0,
);

const employee: PayrollEmployeeSource = {
  employee_id: "emp-1",
  staff_id: staff,
  full_name: "Ama Mensah",
  employment_type: "Casual",
  employment_status: "Active",
  date_hired: "2020-01-01",
  appointment_end_date: null,
  position: "Cleaner",
  shift: "Morning",
  basic_salary: 3000,
  housing_allowance: 0,
  transport_allowance: 0,
  other_allowances: 0,
  department: null,
  contract_project: "PRJ01",
  welfare_deduction_rate: 0,
};
const period = {
  year: 2026,
  month: 10,
  payrollMonth: "2026-10-01",
  totalWorkingDays: 20,
};
const tax = {
  ssnitRows: [],
  casualRows: [],
  payeBands: [],
  overtimeRows: [],
};
const half = calculatePayrollRow(employee, period, tax, {
  absenceCount: 0.5,
  overtimeAmount: 0,
  loanRepayment: 0,
});
assert.equal(half.daily_rate, 150);
assert.equal(half.absence_deduction, 75);
assert.equal(half.absence_deduction, half.daily_rate * 0.5);

const fullDayDecision = countAbsencesForStaff(
  [
    {
      staff_id: staff,
      date: "2026-10-05",
      attendance_status: "Late",
      exception_status: "full_day",
    },
  ],
  staff,
  2026,
  10,
);
assert.equal(fullDayDecision, 0);

const absentWithHalfDay = countAbsencesForStaff(
  [
    {
      staff_id: staff,
      date: "2026-10-19",
      attendance_status: "Absent",
      exception_status: "half_day",
    },
  ],
  staff,
  2026,
  10,
);
assert.equal(absentWithHalfDay, 1);

const halfDayAlone = countAbsencesForStaff(
  [
    {
      staff_id: staff,
      date: "2026-10-08",
      attendance_status: "Present",
      exception_status: "half_day",
    },
  ],
  staff,
  2026,
  10,
);
assert.equal(halfDayAlone, 0.5);

const absentDecisionOnly = countAbsencesForStaff(
  [
    {
      staff_id: staff,
      date: "2026-10-09",
      attendance_status: "Present",
      exception_status: "absent",
    },
  ],
  staff,
  2026,
  10,
);
assert.equal(absentDecisionOnly, 1);

const changedToAbsent = buildExceptionDecisionUpdate({
  previousExceptionStatus: "half_day",
  previousAttendanceStatus: "Absent",
  lateMinutes: 45,
  decision: "absent",
  note: null,
});
assert.equal(changedToAbsent.exception_status, "absent");
assert.equal(changedToAbsent.attendance_status, "Absent");
assert.match(
  changedToAbsent.review_note ?? "",
  /Changed from Half day to Absent/,
);

const keptNote = buildExceptionDecisionUpdate({
  previousExceptionStatus: "half_day",
  previousAttendanceStatus: "Absent",
  previousReviewNote: "Test – left early for meeting",
  decision: "absent",
  note: null,
});
assert.equal(
  keptNote.review_note,
  "Changed from Half day to Absent. Previous note: Test – left early for meeting",
);

const changedToHalfDay = buildExceptionDecisionUpdate({
  previousExceptionStatus: "absent",
  previousAttendanceStatus: "Absent",
  lateMinutes: 45,
  decision: "half_day",
  note: "clocked in",
  attendanceStatus: "Late",
});
assert.equal(changedToHalfDay.exception_status, "half_day");
assert.equal(changedToHalfDay.attendance_status, "Late");
assert.match(
  changedToHalfDay.review_note ?? "",
  /Changed from Absent to Half day\. clocked in/,
);

const halfDayLeavesAbsentStatus = buildExceptionDecisionUpdate({
  previousExceptionStatus: "absent",
  previousAttendanceStatus: "Absent",
  lateMinutes: 0,
  decision: "half_day",
  attendanceStatus: "Absent",
});
assert.equal(halfDayLeavesAbsentStatus.attendance_status, "Present");
assert.equal(halfDayLeavesAbsentStatus.exception_status, "half_day");

assert.equal(decisionRequiredForStatusEdit("half_day", "Absent"), "absent");
assert.equal(
  decisionRequiredForStatusEdit("absent", "Present"),
  "ask_full_or_half",
);
assert.equal(decisionRequiredForStatusEdit("none", "Absent"), null);
assert.equal(
  payrollLockAttendanceMessage("2026-10-19"),
  "Payroll for October 2026 is locked — unlock it first to change attendance.",
);

const noDeduction = calculatePayrollRow(employee, period, tax, {
  absenceCount: fullDayDecision,
  overtimeAmount: 0,
  loanRepayment: 0,
});
assert.equal(noDeduction.absence_deduction, 0);

const blocked = pendingExceptionLockRefusal(2);
assert.ok(blocked);
assert.match(blocked.error, /2 attendance exceptions are still pending/);
assert.equal(
  blocked.exceptionsHref,
  "/dashboard/hr-payroll/attendance#attendance-exceptions",
);
assert.equal(pendingExceptionLockRefusal(0), null);
assert.match(pendingExceptionLockRefusal(1)?.error ?? "", /1 attendance exception is/);

const missingGrace = resolve({
  position: "Cleaner",
  shift: "Morning",
  grace: null,
});
assert.equal(missingGrace?.lateGraceMinutes, 30);
assert.equal(missingGrace?.earlyLeaveGraceMinutes, 30);

assert.equal(scheduleDayTypeForDate("2026-10-16"), "weekday");
assert.equal(scheduleDayTypeForDate("2026-10-17"), "weekend");
assert.equal(scheduleDayTypeForDate("2026-10-18"), "weekend");
assert.equal(
  scheduleDayTypeForDate("2026-10-21", ["2026-10-21"]),
  "weekend",
);

const weekendMorning = {
  ...times("Morning", "04:30", "10:00"),
  day_type: "weekend" as const,
};
const weekendNight = {
  ...times("Night", "20:00", "04:00"),
  day_type: "weekend" as const,
};
const mixedRows = [
  times("Morning", "06:00", "14:00"),
  weekendMorning,
  times("Night", "22:00", "06:00"),
  weekendNight,
];

const saturday = resolve({
  position: "Cleaner",
  shift: "Morning",
  date: "2026-10-17",
  rows: mixedRows,
}) as ExpectedSchedule;
assert.equal(saturday.dayType, "weekend");
assert.equal(saturday.startTime, "04:30:00");
assert.equal(saturday.endTime, "10:00:00");
const saturdayOnTime = attendanceScheduleColumns({
  date: "2026-10-17",
  clockIn: "04:30:00",
  clockOut: "09:45:00",
  schedule: saturday,
});
assert.equal(saturdayOnTime?.early_leave_minutes, 0);
assert.equal(saturdayOnTime?.exception_status, "none");
assert.equal(saturdayOnTime?.scheduled_day_type, "weekend");
const saturdayEarly = attendanceScheduleColumns({
  date: "2026-10-17",
  clockIn: "04:30:00",
  clockOut: "09:00:00",
  schedule: saturday,
});
assert.equal(saturdayEarly?.early_leave_minutes, 60);
assert.equal(saturdayEarly?.exception_status, "pending");
assert.equal(saturdayEarly?.attendance_status, "Present");

assert.equal(
  resolve({
    position: "Cleaner",
    shift: "Morning",
    date: "2026-10-17",
    rows: [times("Morning", "06:00", "14:00")],
  }),
  null,
);
const saturdayUnscheduled = attendanceScheduleColumns({
  date: "2026-10-17",
  clockIn: "06:00:00",
  clockOut: "09:00:00",
  schedule: null,
  dayType: "weekend",
});
assert.equal(saturdayUnscheduled?.exception_status, "none");
assert.equal(saturdayUnscheduled?.early_leave_minutes, 0);
assert.equal(saturdayUnscheduled?.late_minutes, 0);
assert.equal(saturdayUnscheduled?.attendance_status, "Present");

assert.equal(
  resolve({
    position: "Cleaner",
    shift: "Morning",
    date: "2026-10-18",
    rows: [times("Morning", "06:00", "14:00")],
  }),
  null,
);

const holidayWednesday = resolve({
  position: "Cleaner",
  shift: "Morning",
  date: "2026-10-21",
  rows: mixedRows,
  holidays: ["2026-10-21"],
}) as ExpectedSchedule;
assert.equal(holidayWednesday.dayType, "weekend");
assert.equal(holidayWednesday.startTime, "04:30:00");
const holidayEarly = attendanceScheduleColumns({
  date: "2026-10-21",
  clockIn: "04:30:00",
  clockOut: "09:00:00",
  schedule: holidayWednesday,
});
assert.equal(holidayEarly?.early_leave_minutes, 60);
assert.equal(holidayEarly?.scheduled_day_type, "weekend");

const fridayNight = resolve({
  position: "Guard",
  shift: "Night",
  date: "2026-10-16",
  rows: mixedRows,
}) as ExpectedSchedule;
assert.equal(fridayNight.dayType, "weekday");
assert.equal(fridayNight.startTime, "22:00:00");
assert.equal(fridayNight.endTime, "06:00:00");
const fridayColumns = attendanceScheduleColumns({
  date: "2026-10-16",
  clockIn: "22:00:00",
  clockOut: "06:00:00",
  schedule: fridayNight,
});
assert.equal(fridayColumns?.scheduled_day_type, "weekday");
assert.equal(fridayColumns?.scheduled_start, "22:00:00");
assert.equal(fridayColumns?.scheduled_end, "06:00:00");
assert.equal(fridayColumns?.exception_status, "none");

const weekdayFullDay: ExpectedSchedule = {
  clientId: "cust-1",
  shift: "Full Day",
  dayType: "weekday",
  startTime: "08:00:00",
  endTime: "16:00:00",
  crossesMidnight: false,
  lateGraceMinutes: 0,
  earlyLeaveGraceMinutes: 0,
};
const weekdayFullDayRow = attendanceScheduleColumns({
  date: "2026-10-19",
  clockIn: "08:45:00",
  clockOut: "15:00:00",
  schedule: weekdayFullDay,
});
assert.equal(weekdayFullDayRow?.scheduled_start, "08:00:00");
assert.equal(weekdayFullDayRow?.scheduled_end, "16:00:00");
assert.equal(weekdayFullDayRow?.late_minutes, 45);
assert.equal(weekdayFullDayRow?.early_leave_minutes, 60);
assert.equal(weekdayFullDayRow?.exception_status, "pending");
assert.equal(weekdayFullDayRow?.attendance_status, "Late");
assert.equal(String(weekdayFullDayRow?.scheduled_start).includes("T"), false);
assert.equal(String(weekdayFullDayRow?.scheduled_end).includes("T"), false);

const overnight: ExpectedSchedule = {
  clientId: "cust-1",
  shift: "Night",
  dayType: "weekday",
  startTime: "22:00",
  endTime: "06:00",
  crossesMidnight: true,
  lateGraceMinutes: 0,
  earlyLeaveGraceMinutes: 0,
};
const overnightRow = attendanceScheduleColumns({
  date: "2026-10-19",
  clockIn: "22:00:00",
  clockOut: "06:00:00",
  schedule: overnight,
});
assert.equal(overnightRow?.scheduled_start, "22:00:00");
assert.equal(overnightRow?.scheduled_end, "06:00:00");
assert.equal(overnightRow?.late_minutes, 0);
assert.equal(overnightRow?.early_leave_minutes, 0);

console.log("shift attendance tests passed");
