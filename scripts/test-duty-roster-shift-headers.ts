/**
 * Duty roster headers use contract_shift_times, with the old text as fallback.
 *   npx tsx scripts/test-duty-roster-shift-headers.ts
 */
import { buildDutyRosterShiftHeader } from "../app/dashboard/operations/duty-roster-utils";
import type { ShiftTimeRecord } from "../lib/shift-attendance";

function eq(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function row(
  shift: string,
  dayType: "weekday" | "weekend",
  start: string,
  end: string,
): ShiftTimeRecord {
  return {
    client_id: "client-1",
    shift,
    day_type: dayType,
    start_time: start,
    end_time: end,
    late_grace_minutes: null,
    early_leave_grace_minutes: null,
  };
}

const times = [
  row("Morning", "weekday", "06:00:00", "14:00:00"),
  row("Morning", "weekend", "04:30:00", "10:00:00"),
  row("Afternoon", "weekday", "14:00:00", "22:00:00"),
  row("Afternoon", "weekend", "14:00:00", "22:00:00"),
];

const morning = buildDutyRosterShiftHeader({
  clientId: "client-1",
  role: "Morning",
  shiftTimes: times,
  legacyTime: "4:30 AM - 9:00 AM",
});
eq(morning.primary, "6:00 AM – 2:00 PM", "weekday morning");
eq(morning.weekend, "Weekend 4:30 AM – 10:00 AM", "different weekend");
eq(morning.legacy, false, "morning uses new times");

const afternoon = buildDutyRosterShiftHeader({
  clientId: "client-1",
  role: "Afternoon",
  shiftTimes: times,
  legacyTime: "4:30 AM - 1:00 PM",
});
eq(afternoon.primary, "2:00 PM – 10:00 PM", "weekday afternoon");
eq(afternoon.weekend, null, "matching weekend is hidden");
eq(afternoon.legacy, false, "afternoon uses new times");

const supervisor = buildDutyRosterShiftHeader({
  clientId: "client-1",
  role: "Supervisor",
  shiftTimes: times,
  legacyTime: "4:30 AM - 3:00 PM",
});
eq(supervisor.primary, "4:30 AM - 3:00 PM", "old supervisor text");
eq(supervisor.weekend, null, "no weekend line on the old setting");
eq(supervisor.legacy, true, "missing shift row is the old setting");

const otherClient = buildDutyRosterShiftHeader({
  clientId: "client-2",
  role: "Morning",
  shiftTimes: times,
  legacyTime: "4:30 AM - 9:00 AM",
});
eq(otherClient.legacy, true, "another contract keeps its old text");

console.log("duty roster shift header tests passed");
