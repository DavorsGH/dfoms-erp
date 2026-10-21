/**
 * Scanner simulator traffic, duplicate ingest, and the production gate.
 *   npx tsx --conditions=react-server scripts/test-scanner-simulator.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAttlogBody } from "../lib/adms/attlog-parser";
import { ingestAttlogPost } from "../lib/adms/ingest-attlog";
import type { AttendanceDeviceRow } from "../lib/adms/device-registry";
import { iclockUploadIsAttlog } from "../lib/adms/iclock-table";
import { scannerSimulatorAllowed } from "../lib/adms/scanner-simulator-gate";
import {
  SIMULATOR_HEARTBEAT_CALLS,
  SIMULATOR_WORK_CODE,
  attlogLinesParseAsPunches,
  formatAttlogBody,
  gradeScenario,
  expectationForCountedScenario,
  singlePunchCardVerdict,
  simulatorAttendanceSnapshot,
  staffGroupDayExpectation,
  offlineBatchExpectation,
  pairedDayExpectation,
  mondayOf,
  nonAttlogBody,
  nonAttlogLineCount,
  addSecondsKeepingDate,
  freshenFixedPunches,
  simulatorPunchesToSend,
  singlePunchSendPlan,
  SINGLE_PUNCH_ALREADY_EXISTS,
  simulatorRunOffsetSeconds,
  planClockDrift,
  planOfflineBatch,
  planSinglePunch,
  planStaffGroupDay,
  planUnknownPin,
  planWrongTimezone,
  simulatorPunchIsCleanupTarget,
  unusedSimulatorPin,
  weekIsPast,
} from "../lib/adms/scanner-simulator-traffic";

assert.equal(scannerSimulatorAllowed({ NODE_ENV: "development" }), true);
assert.equal(scannerSimulatorAllowed({ NODE_ENV: "test" }), true);
assert.equal(
  scannerSimulatorAllowed({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://wieflwbfdmjtsdnwbfii.supabase.co",
  }),
  false,
  "production deployment stays closed",
);
assert.equal(
  scannerSimulatorAllowed({
    NODE_ENV: "development",
    NEXT_PUBLIC_SUPABASE_URL: "https://tvcurcnmasnocwdxzgvz.supabase.co",
  }),
  false,
  "production project stays closed",
);
assert.equal(
  scannerSimulatorAllowed({
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  }),
  false,
  "a production build that is not staging stays closed",
);
assert.equal(
  scannerSimulatorAllowed({
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: "https://wieflwbfdmjtsdnwbfii.supabase.co",
  }),
  true,
  "staging preview can run the simulator",
);

assert.equal(iclockUploadIsAttlog("ATTLOG"), true);
assert.equal(iclockUploadIsAttlog("attlog"), true);
assert.equal(iclockUploadIsAttlog("OPERLOG"), false);
assert.equal(iclockUploadIsAttlog("USERINFO"), false);
assert.equal(attlogLinesParseAsPunches(nonAttlogBody("2026-10-11")), false);
assert.equal(nonAttlogLineCount(nonAttlogBody("2026-10-11")), 2);
assert.equal(SIMULATOR_HEARTBEAT_CALLS, 10);
assert.equal(
  readFileSync("app/iclock/getrequest/route.ts", "utf8").includes(
    "adms_getrequest_error",
  ),
  true,
  "heartbeat errors are logged and answered OK",
);

assert.equal(mondayOf("2026-10-07"), "2026-10-05");
assert.equal(weekIsPast("2026-10-07", "2026-10-20"), true);
assert.equal(weekIsPast("2026-10-19", "2026-10-20"), false);

const drift = planClockDrift({
  date: "2026-10-10",
  pin: "20",
  start: "08:00:00",
  end: "17:00:00",
});
assert.equal(drift[0]?.localDateTime, "2026-10-10 08:07:00");
assert.equal(drift[1]?.localDateTime, "2026-10-10 16:57:00");
assert.equal(drift[0]?.statusCode, 0);
assert.equal(drift[1]?.statusCode, 1);

const shifted = planWrongTimezone({
  date: "2026-10-11",
  pin: "20",
  start: "08:00:00",
  end: "17:00:00",
});
assert.equal(shifted[0]?.localDateTime, "2026-10-11 09:00:00");
assert.equal(shifted[1]?.localDateTime, "2026-10-11 18:00:00");

const day = planStaffGroupDay({
  date: "2026-10-06",
  people: [
    { pin: "20", start: "08:00:00", end: "17:00:00" },
    { pin: "21", start: "14:00:00", end: "22:00:00" },
  ],
  seed: 42,
});
assert.equal(day.length, 4);
function minutes(local: string): number {
  const match = local.match(/(\d{2}):(\d{2}):\d{2}$/);
  return Number(match?.[1]) * 60 + Number(match?.[2]);
}
assert.ok(Math.abs(minutes(day[0]!.localDateTime) - 8 * 60) <= 20);
assert.ok(Math.abs(minutes(day[1]!.localDateTime) - 17 * 60) <= 20);
assert.ok(day[1]!.localDateTime > day[0]!.localDateTime);

const shortShift = planStaffGroupDay({
  date: "2026-10-06",
  people: [{ pin: "20", start: "08:00:00", end: "08:10:00" }],
  seed: 7,
});
assert.ok(shortShift[1]!.localDateTime > shortShift[0]!.localDateTime);

for (let seed = 1; seed <= 40; seed += 1) {
  const batch = planOfflineBatch({
    dates: ["2026-10-07", "2026-10-08", "2026-10-09"],
    pins: ["20", "21"],
    seed,
  });
  assert.ok(batch.length >= 20 && batch.length <= 50, `batch size ${batch.length}`);
  assert.equal(batch.length % 2, 0);
  for (const punch of batch) {
    assert.ok(
      ["2026-10-07", "2026-10-08", "2026-10-09"].includes(
        punch.localDateTime.slice(0, 10),
      ),
    );
  }
}
assert.equal(
  formatAttlogBody(drift),
  formatAttlogBody(drift),
);
const parsed = parseAttlogBody(formatAttlogBody(drift));
assert.equal(parsed[0]?.workCode, SIMULATOR_WORK_CODE);

const unknownPin = unusedSimulatorPin(["20", "0021"]);
assert.equal(unknownPin, "900000001");
assert.equal(unusedSimulatorPin(["20", "900000001"]), "900000002");
const unknown = planUnknownPin("2026-10-11", unknownPin);
assert.equal(unknown[0]?.pin, "900000001");
assert.equal(unknown[0]?.localDateTime, "2026-10-11 03:15:00");

const firstRunMs = Date.parse("2026-10-20T18:00:00.000Z");
const secondRunMs = firstRunMs + 1000;
const freshUnknownA = freshenFixedPunches({ punches: unknown, nowMs: firstRunMs });
const freshUnknownB = freshenFixedPunches({ punches: unknown, nowMs: secondRunMs });
assert.notEqual(freshUnknownA[0]?.localDateTime, unknown[0]?.localDateTime);
assert.notEqual(freshUnknownA[0]?.localDateTime, freshUnknownB[0]?.localDateTime);
assert.equal(freshUnknownA[0]?.localDateTime.slice(0, 10), "2026-10-11");
assert.equal(freshUnknownB[0]?.pin, "900000001");

const sentDrift = simulatorPunchesToSend({
  scenario: "clock_drift",
  punches: drift,
  nowMs: Date.parse("2026-10-20T23:58:09.000Z"),
});
assert.equal(sentDrift[0]?.localDateTime, "2026-10-10 08:07:00");
assert.equal(sentDrift[1]?.localDateTime, "2026-10-10 16:57:00");
const singleNow = Date.parse("2026-10-20T23:58:09.000Z");
const sentSingle = singlePunchSendPlan({
  pin: "20",
  localDateTime: "2026-10-14 08:30",
  direction: "in",
});
assert.ok(!("error" in sentSingle));
if (!("error" in sentSingle)) {
  assert.equal(sentSingle.punches[0]?.localDateTime, "2026-10-14 08:30:00");
  assert.equal(sentSingle.punches[0]?.statusCode, 0);
  assert.notEqual(
    sentSingle.punches[0]?.localDateTime,
    addSecondsKeepingDate(
      "2026-10-14 08:30:00",
      simulatorRunOffsetSeconds(singleNow),
    ),
  );
}
const duplicateSingle = singlePunchSendPlan({
  pin: "20",
  localDateTime: "2026-10-14 08:30",
  direction: "in",
  taken: new Set(["20|2026-10-14 08:30:00"]),
});
assert.deepEqual(duplicateSingle, { error: SINGLE_PUNCH_ALREADY_EXISTS });

const sentZone = simulatorPunchesToSend({
  scenario: "wrong_timezone",
  punches: shifted,
  nowMs: secondRunMs,
});
assert.equal(sentZone[0]?.localDateTime, "2026-10-11 09:00:00");
assert.equal(sentZone[1]?.localDateTime, "2026-10-11 18:00:00");
assert.equal(addSecondsKeepingDate("2026-10-11 22:30:00", 3 * 60 * 60).slice(0, 10), "2026-10-11");

assert.equal(
  simulatorPunchIsCleanupTarget({
    work_code: SIMULATOR_WORK_CODE,
    device_pin: "20",
    staff_id: "DF0020",
  }),
  true,
);
assert.equal(
  simulatorPunchIsCleanupTarget({
    work_code: null,
    device_pin: "900000001",
    staff_id: null,
  }),
  true,
);
assert.equal(
  simulatorPunchIsCleanupTarget({
    work_code: null,
    device_pin: "900000001",
    staff_id: "DF0020",
  }),
  false,
);
assert.equal(
  simulatorPunchIsCleanupTarget({
    work_code: null,
    device_pin: "20",
    staff_id: null,
  }),
  false,
);

const single = planSinglePunch({
  pin: "20",
  localDateTime: "2026-10-13T08:15",
  direction: "out",
});
assert.equal(single[0]?.localDateTime, "2026-10-13 08:15:00");
assert.equal(single[0]?.statusCode, 1);
assert.equal(
  planSinglePunch({
    pin: "20",
    localDateTime: "2026-10-13 08:15",
    direction: "in",
  })[0]?.localDateTime,
  "2026-10-13 08:15:00",
);

const pass = gradeScenario({
  httpOk: true,
  processingErrors: 0,
  linesSent: 2,
  accepted: 0,
  duplicatesSkipped: 2,
  needsReview: 0,
  attendanceCreated: 0,
  attendanceUpdated: 0,
  expected: expectationForCountedScenario({
    linesSent: 2,
    accepted: 0,
    duplicatesSkipped: 2,
    attendanceMin: 0,
    attendanceMax: 0,
    needsReviewMin: 0,
    needsReviewMax: 0,
  }),
});
assert.equal(pass.pass, true);
const fail = gradeScenario({
  httpOk: true,
  processingErrors: 1,
  linesSent: 1,
  accepted: 1,
  duplicatesSkipped: 0,
  needsReview: 1,
  attendanceCreated: 0,
  attendanceUpdated: 0,
  expected: expectationForCountedScenario({
    linesSent: 1,
    accepted: 1,
    duplicatesSkipped: 0,
    attendanceMin: 0,
    attendanceMax: 0,
    needsReviewMin: 1,
    needsReviewMax: 1,
  }),
});
assert.equal(fail.pass, false);

const unchangedRow = singlePunchCardVerdict({
  httpOk: true,
  processingErrors: 0,
  accepted: 1,
  duplicatesSkipped: 0,
  punchNotes: [],
});
assert.equal(unchangedRow.kind, "summary");
assert.deepEqual(unchangedRow.reasons, []);
const resolvedReview = singlePunchCardVerdict({
  httpOk: true,
  processingErrors: 0,
  accepted: 1,
  duplicatesSkipped: 0,
  punchNotes: ["missing_clock_out"],
});
assert.equal(
  resolvedReview.kind,
  "summary",
  "a stored punch is a summary even when it clears a review",
);
const rejected = singlePunchCardVerdict({
  httpOk: true,
  processingErrors: 1,
  accepted: 1,
  duplicatesSkipped: 0,
  punchNotes: ["processing_error"],
});
assert.equal(rejected.kind, "error");
assert.equal(rejected.reasons[0], "Could not be processed — use Reprocess");
const duplicate = singlePunchCardVerdict({
  httpOk: true,
  processingErrors: 0,
  accepted: 0,
  duplicatesSkipped: 1,
  punchNotes: [],
});
assert.equal(duplicate.kind, "error");
assert.equal(duplicate.reasons[0], SINGLE_PUNCH_ALREADY_EXISTS);

const row = simulatorAttendanceSnapshot({
  date: "2026-10-15",
  clock_in: "06:10:00",
  clock_out: "14:00:00",
  hours_worked: 7.83,
  attendance_status: "Present",
  exception_status: "none",
});
assert.equal(row?.clockIn, "06:10");
assert.equal(row?.clockOut, "14:00");
assert.equal(row?.hours, "7.83");
assert.equal(row?.status, "Present");
assert.equal(row?.exception, "none");

const group = staffGroupDayExpectation(4, 8);
assert.equal(group.attendanceMin, 0);
assert.equal(group.attendanceMax, 4);
const batch = offlineBatchExpectation(10, 5);
assert.equal(batch.attendanceMin, 0);
assert.equal(batch.attendanceMax, 5);
const pair = pairedDayExpectation();
assert.equal(pair.attendanceMin, 0);
assert.equal(pair.attendanceMax, 1);
assert.equal(pair.needsReviewMin, 0);

type Row = Record<string, unknown>;

function memorySupabase(tables: Record<string, Row[]>): SupabaseClient {
  let nextId = 1;
  function builder(table: string) {
    const filters: Array<
      | { type: "eq"; col: string; val: unknown }
      | { type: "is"; col: string; val: unknown }
      | { type: "not"; col: string; op: string; val: unknown }
      | { type: "in"; col: string; vals: unknown[] }
      | { type: "lt"; col: string; val: unknown }
      | { type: "gte"; col: string; val: unknown }
    > = [];
    let op: "select" | "insert" | "update" | "upsert" = "select";
    let payload: Row | null = null;
    let mode: "many" | "single" | "maybe" = "many";

    function matches(row: Row): boolean {
      return filters.every((filter) => {
        const value = row[filter.col];
        if (filter.type === "eq") return value === filter.val;
        if (filter.type === "is") {
          return filter.val === null ? value == null : value === filter.val;
        }
        if (filter.type === "not") {
          return filter.op === "is" && filter.val === null ? value != null : true;
        }
        if (filter.type === "in") return filter.vals.includes(value);
        if (filter.type === "gte") return String(value) >= String(filter.val);
        return String(value) < String(filter.val);
      });
    }

    function exec() {
      const rows = tables[table] ?? (tables[table] = []);
      if (op === "insert" && payload) {
        if (table === "biometric_punches") {
          const duplicate = rows.find(
            (row) =>
              row.device_id === payload?.device_id &&
              row.device_pin === payload?.device_pin &&
              row.punch_time === payload?.punch_time,
          );
          if (duplicate) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
        }
        const row = { id: `row-${nextId++}`, ...payload };
        rows.push(row);
        return { data: mode === "many" ? [row] : row, error: null };
      }
      if (op === "update" && payload) {
        for (const row of rows.filter(matches)) Object.assign(row, payload);
        return { data: null, error: null };
      }
      if (op === "upsert" && payload) {
        const existing = rows.find(
          (row) =>
            row.tenant_id === payload?.tenant_id &&
            row.staff_id === payload?.staff_id &&
            row.date === payload?.date,
        );
        const row = existing
          ? Object.assign(existing, payload)
          : { id: `row-${nextId++}`, ...payload };
        if (!existing) rows.push(row);
        return { data: mode === "many" ? [row] : row, error: null };
      }
      const found = rows.filter(matches);
      if (mode === "maybe") return { data: found[0] ?? null, error: null };
      if (mode === "single") {
        return found[0]
          ? { data: found[0], error: null }
          : { data: null, error: { message: "No rows" } };
      }
      return { data: found, error: null };
    }

    const chain = {
      select() {
        return chain;
      },
      insert(row: Row) {
        op = "insert";
        payload = row;
        return chain;
      },
      update(row: Row) {
        op = "update";
        payload = row;
        return chain;
      },
      upsert(row: Row) {
        op = "upsert";
        payload = row;
        return chain;
      },
      eq(col: string, val: unknown) {
        filters.push({ type: "eq", col, val });
        return chain;
      },
      is(col: string, val: unknown) {
        filters.push({ type: "is", col, val });
        return chain;
      },
      not(col: string, filterOp: string, val: unknown) {
        filters.push({ type: "not", col, op: filterOp, val });
        return chain;
      },
      in(col: string, vals: unknown[]) {
        filters.push({ type: "in", col, vals });
        return chain;
      },
      lt(col: string, val: unknown) {
        filters.push({ type: "lt", col, val });
        return chain;
      },
      gte(col: string, val: unknown) {
        filters.push({ type: "gte", col, val });
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        mode = "maybe";
        return chain;
      },
      single() {
        mode = "single";
        return chain;
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(exec()).then(resolve, reject);
      },
    };
    return chain;
  }
  return { from(table: string) { return builder(table); } } as unknown as SupabaseClient;
}

const tenantId = "tenant-1";
const device: AttendanceDeviceRow = {
  id: "device-1",
  tenant_id: tenantId,
  serial_number: "SIMSN001",
  status: "active",
  timezone: "Africa/Accra",
  site_code: "SI-004",
  contract_project: null,
  company_wide: true,
};

function emptyStore(): Record<string, Row[]> {
  return {
    employee_biometric_ids: [
      { tenant_id: tenantId, staff_id: "DF0020", device_pin: "20" },
    ],
    employees: [
      {
        tenant_id: tenantId,
        staff_id: "DF0020",
        employment_type: "Full-time",
        contract_project: null,
        assigned_site_id: null,
      },
    ],
    biometric_punches: [],
    attendance_register: [],
    projects: [],
    sites: [],
    contract_shift_times: [],
    attendance_grace_policy: [],
    tenant_holidays: [],
    roster_history: [],
    system_event_log: [],
  };
}

async function main() {
  const nowMs = Date.parse("2026-10-20T18:00:00.000Z");
  const store = emptyStore();
  const client = memorySupabase(store);
  const body = formatAttlogBody(
    planClockDrift({
      date: "2026-10-13",
      pin: "20",
      start: "08:00:00",
      end: "16:00:00",
    }),
  );
  const first = await ingestAttlogPost(client, device, body, { nowMs });
  assert.equal(first.acceptedLines, 2);
  assert.equal(store.biometric_punches?.length, 2);
  assert.equal(store.attendance_register?.length, 1);
  assert.equal(String(store.attendance_register?.[0]?.clock_in).slice(0, 5), "08:07");
  assert.equal(String(store.attendance_register?.[0]?.clock_out).slice(0, 5), "15:57");
  const second = await ingestAttlogPost(client, device, body, { nowMs });
  assert.equal(second.acceptedLines, 2);
  assert.equal(
    store.biometric_punches?.length,
    2,
    "re-sending the same ATTLOG does not insert duplicates",
  );
  assert.equal(store.attendance_register?.length, 1);

  const unknownStore = emptyStore();
  const unknownClient = memorySupabase(unknownStore);
  const unknownBody = formatAttlogBody(planUnknownPin("2026-10-13", "900000001"));
  await ingestAttlogPost(unknownClient, device, unknownBody, { nowMs });
  assert.equal(unknownStore.biometric_punches?.length, 1);
  assert.equal(unknownStore.biometric_punches?.[0]?.staff_id ?? null, null);
  assert.equal(unknownStore.attendance_register?.length, 0);
  assert.equal(unknownStore.biometric_punches?.[0]?.work_code, SIMULATOR_WORK_CODE);

  const exactStore = emptyStore();
  const exactPlan = singlePunchSendPlan({
    pin: "20",
    localDateTime: "2026-10-14 08:30",
    direction: "in",
  });
  assert.ok(!("error" in exactPlan));
  if (!("error" in exactPlan)) {
    await ingestAttlogPost(
      memorySupabase(exactStore),
      device,
      formatAttlogBody(exactPlan.punches),
      { nowMs: singleNow },
    );
  }
  assert.equal(
    exactStore.biometric_punches?.[0]?.punch_time,
    "2026-10-14T08:30:00.000Z",
  );

  const ignored = await ingestAttlogPost(
    memorySupabase(emptyStore()),
    device,
    nonAttlogBody("2026-10-13"),
    { nowMs },
  );
  assert.equal(ignored.acceptedLines, 0);

  console.log("scanner simulator tests passed");
}

void main();
