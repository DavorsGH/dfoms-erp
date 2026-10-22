import assert from "node:assert/strict";
import { parseAttlogLine, parseAttlogBody } from "../lib/adms/attlog-parser";
import {
  filterDuplicateTaps,
  groupPunchesIntoSessions,
  hoursWorkedBetween,
  recomputeSessionClocks,
} from "../lib/adms/punch-session-utils";
import { sessionProcessNote } from "../lib/adms/punch-contract";
import {
  buildStaffGroups,
  type StaffGroupProject,
} from "../lib/attendance-staff-groups";
import { localDateTimeToUtcIso } from "../lib/adms/timezone-utils";

function testParser() {
  const row = parseAttlogLine("1001\t2026-03-01 08:00:00\t0\t1\t0");
  assert.ok(row);
  assert.equal(row.devicePin, "1001");
  assert.equal(row.localDateTime, "2026-03-01 08:00:00");
  assert.equal(parseAttlogBody("bad line\n").length, 0);
}

function testTimezone() {
  const converted = localDateTimeToUtcIso("2026-03-01 08:00:00", "Africa/Accra");
  assert.ok(converted);
  assert.equal(converted.punchLocalDate, "2026-03-01");
}

function testNightShiftSession() {
  const punches = [
    { id: "1", staffId: "EMP1", punchTimeIso: "2026-03-01T22:00:00.000Z" },
    { id: "2", staffId: "EMP1", punchTimeIso: "2026-03-02T06:00:00.000Z" },
  ];
  const sessions = groupPunchesIntoSessions(punches, () => "2026-03-01");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.missingClockOut, false);
  assert.equal(sessions[0]?.punchIds.length, 2);
}

function testSinglePunch() {
  const sessions = groupPunchesIntoSessions(
    [{ id: "1", staffId: "EMP1", punchTimeIso: "2026-03-01T08:00:00.000Z" }],
    () => "2026-03-01",
  );
  assert.equal(sessions[0]?.missingClockOut, true);
  assert.equal(sessions[0]?.clockOutIso, null);
}

function testHours() {
  assert.equal(
    hoursWorkedBetween("2026-03-01T08:00:00.000Z", "2026-03-01T17:00:00.000Z"),
    9,
  );
}

function testDoubleTap() {
  const punches = [
    { punchTimeIso: "2026-03-01T08:00:00.000Z" },
    { punchTimeIso: "2026-03-01T08:01:00.000Z" },
    { punchTimeIso: "2026-03-01T12:00:00.000Z" },
  ];
  const { kept, duplicateIndices } = filterDuplicateTaps(punches);
  assert.equal(kept.length, 2);
  assert.equal(duplicateIndices.length, 1);
}

function testNormalDaySessions() {
  const punches = [
    { id: "1", staffId: "EMP1", punchTimeIso: "2026-03-01T08:00:00.000Z" },
    { id: "2", staffId: "EMP1", punchTimeIso: "2026-03-01T17:00:00.000Z" },
  ];
  const sessions = groupPunchesIntoSessions(punches, () => "2026-03-01");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.missingClockOut, false);
  assert.equal(
    hoursWorkedBetween(
      sessions[0]!.clockInIso,
      sessions[0]!.clockOutIso!,
    ),
    9,
  );
}

/** Idempotent session grouping: same input yields same session boundaries. */
function testRerunIdempotency() {
  const punches = [
    { id: "a", staffId: "EMP1", punchTimeIso: "2026-03-01T08:00:00.000Z" },
    { id: "b", staffId: "EMP1", punchTimeIso: "2026-03-01T17:00:00.000Z" },
  ];
  const first = groupPunchesIntoSessions(punches, () => "2026-03-01");
  const second = groupPunchesIntoSessions(punches, () => "2026-03-01");
  assert.deepEqual(first, second);
}

const CU_CONTRACT = "72736a11-e690-4d3f-a618-2598a96ca051";

const STAFF_GROUP_PROJECTS: StaffGroupProject[] = [
  {
    project_code: "PRJ01",
    project_name: "Central University",
    service_contract_id: CU_CONTRACT,
    site_count: 4,
  },
  {
    project_code: "PRJ09",
    project_name: "Students Centre [Plaza]",
    service_contract_id: CU_CONTRACT,
    is_archived: true,
  },
  {
    project_code: "PRJ10",
    project_name: "Trinity Hall",
    service_contract_id: CU_CONTRACT,
  },
  {
    project_code: "PRJ11",
    project_name: "Basement",
    service_contract_id: CU_CONTRACT,
    is_archived: true,
  },
  {
    project_code: "PRJ12",
    project_name: "CU Students' Girls Hostel",
    service_contract_id: CU_CONTRACT,
    is_archived: true,
  },
  {
    project_code: "PRJ08",
    project_name: "Davors Office",
    service_contract_id: null,
    site_count: 1,
  },
];

function testServiceContractGroupAnchor() {
  const groups = buildStaffGroups(STAFF_GROUP_PROJECTS);
  const central = groups.find((group) => group.anchorProjectCode === "PRJ01");
  assert.ok(central);
  assert.equal(central.label, "Central University");
  assert.ok(central.projectCodes.includes("PRJ10"));
  assert.ok(central.projectCodes.includes("PRJ09"));
  const office = groups.find((group) => group.isOffice);
  assert.equal(office?.anchorProjectCode, "PRJ08");
  assert.equal(office?.label, "Davors Office");
}

function testOtherContractNote() {
  assert.equal(
    sessionProcessNote({
      companyWide: false,
      deviceContractProject: "PRJ01",
      employeeContractProject: "PRJ10",
      missingClockOut: false,
      projects: STAFF_GROUP_PROJECTS,
    }),
    null,
    "PRJ10 employee on a PRJ01-anchored device is the same service contract",
  );
  assert.equal(
    sessionProcessNote({
      companyWide: false,
      deviceContractProject: "PRJ01",
      employeeContractProject: "PRJ08",
      missingClockOut: false,
      projects: STAFF_GROUP_PROJECTS,
    }),
    "other_contract",
    "PRJ08 employee on a Central University device is another group",
  );
  assert.equal(
    sessionProcessNote({
      companyWide: false,
      deviceContractProject: "PRJ01",
      employeeContractProject: null,
      missingClockOut: true,
      projects: STAFF_GROUP_PROJECTS,
    }),
    "other_contract",
  );
  assert.equal(
    sessionProcessNote({
      companyWide: true,
      deviceContractProject: null,
      employeeContractProject: "PRJ08",
      missingClockOut: false,
      projects: STAFF_GROUP_PROJECTS,
    }),
    null,
  );
  assert.equal(
    sessionProcessNote({
      companyWide: true,
      deviceContractProject: "PRJ01",
      employeeContractProject: "PRJ08",
      missingClockOut: true,
      projects: STAFF_GROUP_PROJECTS,
    }),
    "missing_clock_out",
  );
}

/** manual_row_exists is enforced in punch-processor against attendance_register (DB). */
function testManualRowExistsPlaceholder() {
  assert.ok(true, "manual_row_exists path requires DB integration test");
}

function testLatePunchJoinsOpenSession() {
  const sessions = groupPunchesIntoSessions(
    [
      {
        id: "out",
        staffId: "DF0001",
        punchTimeIso: "2026-10-20T16:00:00.000Z",
      },
    ],
    (iso) => iso.slice(0, 10),
    [
      {
        staffId: "DF0001",
        sessionDate: "2026-10-20",
        clockInIso: "2026-10-20T08:00:00.000Z",
        punchIds: ["in"],
      },
    ],
  );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.clockInIso, "2026-10-20T08:00:00.000Z");
  assert.equal(sessions[0]?.clockOutIso, "2026-10-20T16:00:00.000Z");
  assert.equal(sessions[0]?.missingClockOut, false);
  assert.deepEqual(sessions[0]?.punchIds, ["in", "out"]);
  assert.equal(
    hoursWorkedBetween(sessions[0]!.clockInIso, sessions[0]!.clockOutIso!),
    8,
  );
}

function testPunchOutsideOpenWindowStartsNewSession() {
  const sessions = groupPunchesIntoSessions(
    [
      {
        id: "next",
        staffId: "DF0001",
        punchTimeIso: "2026-10-21T08:00:00.000Z",
      },
    ],
    (iso) => iso.slice(0, 10),
    [
      {
        staffId: "DF0001",
        sessionDate: "2026-10-20",
        clockInIso: "2026-10-20T08:00:00.000Z",
        punchIds: ["in"],
      },
    ],
  );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.clockInIso, "2026-10-21T08:00:00.000Z");
  assert.equal(sessions[0]?.clockOutIso, null);
  assert.deepEqual(sessions[0]?.punchIds, ["next"]);
}

function testBatchThatContainsClockInIgnoresStaleAnchor() {
  const sessions = groupPunchesIntoSessions(
    [
      {
        id: "in",
        staffId: "DF0001",
        punchTimeIso: "2026-10-20T08:00:00.000Z",
      },
      {
        id: "out",
        staffId: "DF0001",
        punchTimeIso: "2026-10-20T16:00:00.000Z",
      },
    ],
    (iso) => iso.slice(0, 10),
    [
      {
        staffId: "DF0001",
        sessionDate: "2026-10-20",
        clockInIso: "2026-10-20T16:00:00.000Z",
        punchIds: ["out"],
      },
    ],
  );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.clockInIso, "2026-10-20T08:00:00.000Z");
  assert.equal(sessions[0]?.clockOutIso, "2026-10-20T16:00:00.000Z");
  assert.equal(sessions[0]?.missingClockOut, false);
}

testParser();
testTimezone();
testNightShiftSession();
testSinglePunch();
testHours();
testDoubleTap();
testNormalDaySessions();
testRerunIdempotency();
testServiceContractGroupAnchor();
testOtherContractNote();
testManualRowExistsPlaceholder();
function testSessionClocksFromEveryPunch() {
  const inThenOut = recomputeSessionClocks([
    { id: "in", punchTimeIso: "2026-10-14T08:30:00.000Z", statusCode: 0 },
    { id: "out", punchTimeIso: "2026-10-14T14:00:00.000Z", statusCode: 1 },
  ]);
  assert.equal(inThenOut?.clockInIso, "2026-10-14T08:30:00.000Z");
  assert.equal(inThenOut?.clockOutIso, "2026-10-14T14:00:00.000Z");
  assert.equal(inThenOut?.missingClockOut, false);

  const outArrivedFirst = recomputeSessionClocks([
    { id: "out", punchTimeIso: "2026-10-14T14:00:00.000Z", statusCode: 1 },
    { id: "in", punchTimeIso: "2026-10-14T08:30:00.000Z", statusCode: 0 },
  ]);
  assert.equal(outArrivedFirst?.clockInIso, "2026-10-14T08:30:00.000Z");
  assert.equal(outArrivedFirst?.clockOutIso, "2026-10-14T14:00:00.000Z");
  assert.notEqual(outArrivedFirst?.clockInIso, "2026-10-14T14:00:00.000Z");

  const three = recomputeSessionClocks([
    { id: "mid", punchTimeIso: "2026-10-14T12:00:00.000Z", statusCode: 0 },
    { id: "out", punchTimeIso: "2026-10-14T16:00:00.000Z", statusCode: 1 },
    { id: "in", punchTimeIso: "2026-10-14T08:00:00.000Z", statusCode: 0 },
  ]);
  assert.equal(three?.clockInIso, "2026-10-14T08:00:00.000Z");
  assert.equal(three?.clockOutIso, "2026-10-14T16:00:00.000Z");
  assert.equal(hoursWorkedBetween(three!.clockInIso, three!.clockOutIso!), 8);
  assert.deepEqual(three?.punchIds, ["in", "mid", "out"]);
}

testSessionClocksFromEveryPunch();
testLatePunchJoinsOpenSession();
testPunchOutsideOpenWindowStartsNewSession();
testBatchThatContainsClockInIgnoresStaleAnchor();
console.log("test-adms-attlog-processor: all assertions passed");
