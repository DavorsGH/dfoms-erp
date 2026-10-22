/**
 * Regression: ATTLOG ingest processes punches in the same request, including
 * when the device has no staff group (contract_project null).
 *
 * Usage: npx tsx --conditions=react-server scripts/test-adms-punch-processing.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestAttlogPost } from "../lib/adms/ingest-attlog";
import type { AttendanceDeviceRow } from "../lib/adms/device-registry";
import {
  FUTURE_CLOCK_SKEW_MS,
  processingErrorAlreadyLogged,
  processingErrorLogKey,
  punchNeedsProcessing,
} from "../lib/adms/punch-eligibility";
import {
  SESSION_WINDOW_MS,
  sessionWindowHasClosed,
} from "../lib/adms/punch-session-utils";
import {
  reviewNoteCode,
  reviewNoteLabel,
  UNMAPPED_PIN_LABEL,
} from "../lib/adms/review-note-text";
import { processBiometricPunchesForTenant } from "../lib/adms/punch-processor";
import { resolveReportedPunchTime } from "../lib/adms/device-clock";

assert.equal(
  punchNeedsProcessing({
    staff_id: "DF0020",
    processed_at: null,
    process_note: null,
  }),
  true,
  "a punch with a null process note still needs processing",
);
assert.equal(
  punchNeedsProcessing({
    staff_id: "DF0020",
    processed_at: null,
    process_note: "future_time",
  }),
  false,
);
const futureHeldUntil = Date.parse("2026-10-20T10:00:00.000Z");
assert.ok(2 * 60 * 1000 < FUTURE_CLOCK_SKEW_MS);
assert.equal(
  punchNeedsProcessing(
    {
      staff_id: "DF0020",
      processed_at: null,
      process_note: "future_time",
      punch_time: new Date(futureHeldUntil + 2 * 60 * 1000).toISOString(),
    },
    null,
    futureHeldUntil,
  ),
  false,
  "a punch two minutes ahead stays held",
);
assert.equal(
  punchNeedsProcessing(
    {
      staff_id: "DF0020",
      processed_at: null,
      process_note: "future_time",
      punch_time: new Date(futureHeldUntil + 2 * 60 * 1000).toISOString(),
    },
    null,
    futureHeldUntil + 2 * 60 * 1000,
  ),
  true,
  "a held punch is eligible once now reaches its timestamp",
);
assert.equal(
  punchNeedsProcessing(
    {
      staff_id: "DF0020",
      processed_at: null,
      process_note: "future_time:dismissed",
      punch_time: new Date(futureHeldUntil - 60_000).toISOString(),
    },
    null,
    futureHeldUntil,
  ),
  false,
  "a dismissed punch stays dismissed",
);
assert.equal(
  punchNeedsProcessing({
    staff_id: "DF0020",
    processed_at: null,
    process_note: "processing_error",
    punch_time: "2026-10-19T08:45:00.000Z",
  }),
  false,
  "a processing_error punch is not retried by a background refresh",
);
assert.equal(
  punchNeedsProcessing(
    {
      staff_id: "DF0020",
      processed_at: null,
      process_note: "processing_error",
      punch_time: "2026-10-19T08:45:00.000Z",
    },
    null,
    Date.parse("2026-10-19T09:00:00.000Z"),
    { retryProcessingErrors: true },
  ),
  true,
  "Reprocess and a new ingest may retry a processing_error punch",
);
const errorKey = processingErrorLogKey(
  'invalid input syntax for type time: "2026-10-19T16:00:00.000Z"',
  ["edda6396", "0ac71515"],
);
assert.equal(
  processingErrorAlreadyLogged(
    [
      {
        key: errorKey,
        atMs: Date.parse("2026-10-19T16:05:00.000Z"),
      },
    ],
    'invalid input syntax for type time: "2026-10-19T16:00:00.000Z"',
    ["0ac71515", "edda6396"],
    Date.parse("2026-10-19T16:10:00.000Z"),
  ),
  true,
);
assert.equal(
  processingErrorAlreadyLogged(
    [
      {
        key: errorKey,
        atMs: Date.parse("2026-10-19T16:05:00.000Z"),
      },
    ],
    'invalid input syntax for type time: "2026-10-19T16:00:00.000Z"',
    ["0ac71515", "edda6396"],
    Date.parse("2026-10-19T16:20:00.000Z"),
  ),
  false,
);
assert.equal(
  reviewNoteLabel({ processNote: "future_time", staffId: "DF0020" }),
  "Punch time is in the future (held until then)",
);
assert.equal(
  reviewNoteLabel({ processNote: "missing_clock_out", staffId: "DF0020" }),
  "No clock-out recorded",
);
assert.equal(
  reviewNoteLabel({ processNote: null, staffId: null }),
  UNMAPPED_PIN_LABEL,
);
assert.equal(
  reviewNoteLabel({ processNote: "processing_error", staffId: "DF0020" }),
  "Could not be processed — use Reprocess",
);
assert.equal(
  reviewNoteLabel({ processNote: "manual_row_exists", staffId: "DF0020" }),
  "An attendance row already exists for this day",
);
assert.equal(
  reviewNoteCode({ processNote: "future_time", staffId: "DF0020" }),
  "future_time",
);
const sessionStart = "2026-10-20T07:02:00.000Z";
assert.equal(
  sessionWindowHasClosed(sessionStart, Date.parse(sessionStart) + 60_000),
  false,
);
assert.equal(
  sessionWindowHasClosed(
    sessionStart,
    Date.parse(sessionStart) + SESSION_WINDOW_MS + 60_000,
  ),
  true,
);

const processorSource = readFileSync("lib/adms/punch-processor.ts", "utf8");
assert.equal(
  processorSource.includes('.neq("process_note"'),
  false,
  "processor must not use SQL <> on process_note (NULL rows would be dropped)",
);

type Row = Record<string, unknown>;

function memorySupabase(tables: Record<string, Row[]>): SupabaseClient {
  let nextId = 1;

  function builder(table: string) {
    const filters: Array<
      | { type: "eq"; col: string; val: unknown }
      | { type: "is"; col: string; val: unknown }
      | { type: "not"; col: string; op: string; val: unknown }
      | { type: "neq"; col: string; val: unknown }
      | { type: "in"; col: string; vals: unknown[] }
      | { type: "lt"; col: string; val: unknown }
    > = [];
    let op: "select" | "insert" | "update" | "upsert" = "select";
    let payload: Row | null = null;
    let mode: "many" | "single" | "maybe" = "many";

    function matches(row: Row): boolean {
      return filters.every((filter) => {
        const value = row[filter.col];
        if (filter.type === "eq") {
          return value === filter.val;
        }
        if (filter.type === "is") {
          return filter.val === null ? value == null : value === filter.val;
        }
        if (filter.type === "not") {
          return filter.op === "is" && filter.val === null ? value != null : true;
        }
        if (filter.type === "neq") {
          // SQL `<>` does not match NULL.
          return value != null && value !== filter.val;
        }
        if (filter.type === "in") {
          return filter.vals.includes(value);
        }
        return String(value) < String(filter.val);
      });
    }

    function exec() {
      const rows = tables[table] ?? (tables[table] = []);
      if (op === "insert" && payload) {
        const row = { id: `row-${nextId++}`, ...payload };
        rows.push(row);
        return { data: mode === "many" ? [row] : row, error: null };
      }
      if (op === "update" && payload) {
        for (const row of rows.filter(matches)) {
          Object.assign(row, payload);
        }
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
        if (!existing) {
          rows.push(row);
        }
        if (mode === "many") {
          return { data: [row], error: null };
        }
        return { data: row, error: null };
      }
      const found = rows.filter(matches);
      if (mode === "maybe") {
        return { data: found[0] ?? null, error: null };
      }
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
      neq(col: string, val: unknown) {
        filters.push({ type: "neq", col, val });
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

  return {
    from(table: string) {
      return builder(table);
    },
  } as unknown as SupabaseClient;
}

const tenantId = "tenant-1";
const tables: Record<string, Row[]> = {
  employee_biometric_ids: [
    { tenant_id: tenantId, staff_id: "DF0020", device_pin: "20" },
  ],
  employees: [
    {
      tenant_id: tenantId,
      staff_id: "DF0020",
      employment_type: "Full-time",
      contract_project: "PRJ01",
      assigned_site_id: null,
    },
  ],
  biometric_punches: [],
  attendance_register: [],
  projects: [],
};

const device: AttendanceDeviceRow = {
  id: "device-1",
  tenant_id: tenantId,
  serial_number: "TESTSN001",
  status: "active",
  timezone: "Africa/Accra",
  site_code: "SI-004",
  contract_project: null,
  company_wide: false,
};

const body = [
  "20 2026-10-20 07:02:00 0 1",
  "20 2026-10-20 12:30:00 0 1",
].join("\n");

async function main() {
const result = await ingestAttlogPost(memorySupabase(tables), device, body);
assert.equal(result.acceptedLines, 2);
assert.deepEqual(result.staffIds, ["DF0020"]);

const punches = tables.biometric_punches ?? [];
assert.equal(punches.length, 2);
assert.ok(
  punches.every((punch) => punch.processed_at && punch.staff_id === "DF0020"),
  "both punches are processed before ingest returns",
);
assert.ok(
  punches.every((punch) => punch.process_note !== "processing_error"),
  "a device with no staff group does not fail processing",
);

const attendance = tables.attendance_register ?? [];
assert.equal(attendance.length, 1);
const row = attendance[0]!;
assert.equal(row.staff_id, "DF0020");
assert.equal(row.date, "2026-10-20");
assert.equal(String(row.clock_in).slice(0, 5), "07:02");
assert.equal(String(row.clock_out).slice(0, 5), "12:30");
assert.equal(row.hours_worked, 5.47);
assert.equal(row.source, "device");
assert.equal(row.attendance_status, "Present");
assert.equal(row.site_code, "SI-004");
assert.ok(
  punches.every((punch) => punch.process_note == null),
  "no staff group skips the other-contract flag",
);

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
        contract_project: "PRJ01",
        assigned_site_id: null,
      },
    ],
    biometric_punches: [],
    attendance_register: [],
    projects: [],
  };
}

const futureNow = Date.parse("2026-10-20T10:00:00.000Z");
const futureStore = emptyStore();
const futureClient = memorySupabase(futureStore);
await ingestAttlogPost(
  futureClient,
  device,
  "20 2026-10-20 10:02:00 0 1",
  { nowMs: futureNow },
);
const held = futureStore.biometric_punches?.[0];
assert.ok(held);
assert.equal(held.process_note, "future_time");
assert.equal(held.processed_at ?? null, null);
await processBiometricPunchesForTenant(futureClient, tenantId, {
  nowMs: futureNow + 2 * 60 * 1000,
});
assert.ok(held.processed_at, "the punch is processed once now reaches its time");
assert.notEqual(held.process_note, "future_time");

const openNow = Date.parse("2026-10-20T07:03:00.000Z");
const openStore = emptyStore();
const openClient = memorySupabase(openStore);
await ingestAttlogPost(openClient, device, "20 2026-10-20 07:02:00 0 1", {
  nowMs: openNow,
});
const openPunch = openStore.biometric_punches?.[0];
const openRow = openStore.attendance_register?.[0];
assert.ok(openPunch?.processed_at);
assert.equal(openPunch.process_note ?? null, null);
assert.equal(openRow?.clock_out ?? null, null);
await processBiometricPunchesForTenant(openClient, tenantId, {
  dueFutureOnly: true,
  nowMs: openNow + SESSION_WINDOW_MS + 60_000,
});
assert.equal(
  openPunch.process_note,
  "missing_clock_out",
  "missing clock-out is flagged only after the 16-hour window",
);

openPunch.process_note = "missing_clock_out:dismissed";
await processBiometricPunchesForTenant(openClient, tenantId, {
  dueFutureOnly: true,
  nowMs: openNow + SESSION_WINDOW_MS + 120_000,
});
assert.equal(openPunch.process_note, "missing_clock_out:dismissed");

const scheduleStore = emptyStore();
scheduleStore.employees = [
  {
    tenant_id: tenantId,
    staff_id: "DF0020",
    employee_id: "emp-1",
    employment_type: "Full-time",
    contract_project: "PRJ01",
    assigned_site_id: null,
    position: "Cleaner",
    shift: "Morning",
  },
];
scheduleStore.projects = [
  {
    tenant_id: tenantId,
    project_code: "PRJ01",
    project_name: "Central",
    service_contract_id: null,
    is_archived: false,
  },
];
scheduleStore.sites = [
  { tenant_id: tenantId, client_id: "cust-1", project_code: "PRJ01" },
];
scheduleStore.contract_shift_times = [
  {
    tenant_id: tenantId,
    client_id: "cust-1",
    shift: "Morning",
    start_time: "06:00:00",
    end_time: "14:00:00",
    late_grace_minutes: null,
    early_leave_grace_minutes: null,
  },
];
scheduleStore.attendance_grace_policy = [
  {
    tenant_id: tenantId,
    late_grace_minutes: 30,
    early_leave_grace_minutes: 30,
  },
];
await ingestAttlogPost(memorySupabase(scheduleStore), device, body);
const scheduled = scheduleStore.attendance_register?.[0];
assert.equal(scheduled?.attendance_status, "Late");
assert.equal(scheduled?.exception_status, "pending");
assert.equal(scheduled?.scheduled_shift, "Morning");
assert.equal(scheduled?.late_minutes, 62);
assert.equal(scheduled?.early_leave_minutes, 90);
assert.equal(scheduled?.scheduled_start, "06:00:00");
assert.equal(scheduled?.scheduled_end, "14:00:00");

const reviewedStore = emptyStore();
reviewedStore.employees = scheduleStore.employees;
reviewedStore.projects = scheduleStore.projects;
reviewedStore.sites = scheduleStore.sites;
reviewedStore.contract_shift_times = scheduleStore.contract_shift_times;
reviewedStore.attendance_grace_policy = scheduleStore.attendance_grace_policy;
reviewedStore.attendance_register = [
  {
    id: "kept-row",
    tenant_id: tenantId,
    staff_id: "DF0020",
    date: "2026-10-19",
    source: "device",
    exception_status: "full_day",
    attendance_status: "Absent",
    late_minutes: 10,
    clock_in: "07:00:00",
  },
];
await ingestAttlogPost(
  memorySupabase(reviewedStore),
  device,
  "20 2026-10-19 08:00:00 0 1",
);
const keptRow = reviewedStore.attendance_register?.[0];
assert.equal(keptRow?.attendance_status, "Absent");
assert.equal(keptRow?.exception_status, "full_day");
assert.equal(String(keptRow?.clock_in).slice(0, 5), "08:00");
assert.equal(keptRow?.late_minutes, 120);

const sentAt = Date.parse("2026-10-20T23:58:09.000Z");
const staleClock = "2026-10-20T22:53:30.000Z";
const reported = resolveReportedPunchTime({
  localDateTime: "2026-10-14 08:30:00",
  timeZone: "Africa/Accra",
  serverNowMs: sentAt,
  storedDeviceClockIso: staleClock,
  freshDeviceClockIso: null,
});
assert.equal(reported?.punchTimeIso, "2026-10-14T08:30:00.000Z");
assert.equal(reported?.reviewNote, null);
const freshDrift = resolveReportedPunchTime({
  localDateTime: "2026-10-14 08:30:00",
  timeZone: "Africa/Accra",
  serverNowMs: sentAt,
  storedDeviceClockIso: staleClock,
  freshDeviceClockIso: new Date(sentAt + 8 * 60 * 1000).toISOString(),
});
assert.equal(freshDrift?.punchTimeIso, "2026-10-14T08:30:00.000Z");
assert.equal(
  freshDrift?.reviewNote,
  "Scanner clock is 8 minutes off; check the scanner time",
);

async function punchPair(bodies: string[]) {
  const store = emptyStore();
  const client = memorySupabase(store);
  for (const [index, body] of bodies.entries()) {
    await ingestAttlogPost(client, device, body, {
      nowMs: sentAt + index * 56_000,
    });
  }
  return store.attendance_register?.[0];
}

const inThenOut = await punchPair([
  "20 2026-10-14 08:30:00 0 1",
  "20 2026-10-14 14:00:00 1 1",
]);
assert.equal(String(inThenOut?.clock_in).slice(0, 5), "08:30");
assert.equal(String(inThenOut?.clock_out).slice(0, 5), "14:00");
assert.equal(inThenOut?.hours_worked, 5.5);

const outThenIn = await punchPair([
  "20 2026-10-14 14:00:00 1 1",
  "20 2026-10-14 08:30:00 0 1",
]);
assert.equal(String(outThenIn?.clock_in).slice(0, 5), "08:30");
assert.equal(String(outThenIn?.clock_out).slice(0, 5), "14:00");

const threePunches = await punchPair([
  "20 2026-10-14 08:00:00 0 1",
  "20 2026-10-14 12:00:00 0 1",
  "20 2026-10-14 16:00:00 1 1",
]);
assert.equal(String(threePunches?.clock_in).slice(0, 5), "08:00");
assert.equal(String(threePunches?.clock_out).slice(0, 5), "16:00");
assert.equal(threePunches?.hours_worked, 8);

const exactStore = emptyStore();
await ingestAttlogPost(
  memorySupabase(exactStore),
  device,
  "20 2026-10-14 08:30:00 0 1",
  { nowMs: sentAt, storedDeviceClockIso: staleClock },
);
assert.equal(
  exactStore.biometric_punches?.[0]?.punch_time,
  "2026-10-14T08:30:00.000Z",
);

console.log("adms punch processing tests passed");
}

void main();

