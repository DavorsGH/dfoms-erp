import { parseAttlogBody } from "@/lib/adms/attlog-parser";
import { reviewNoteLabel } from "@/lib/adms/review-note-text";

/** Stored on work_code so cleanup can delete simulator punches only. */
export const SIMULATOR_WORK_CODE = "DFOMS-SIM";

export const SIMULATOR_HEARTBEAT_CALLS = 10;

export const SIMULATOR_SCENARIOS = [
  "single_punch",
  "staff_group_day",
  "offline_batch",
  "resend_batch",
  "clock_drift",
  "wrong_timezone",
  "unknown_pin",
  "non_attlog",
  "heartbeat",
] as const;

export type SimulatorScenarioId = (typeof SIMULATOR_SCENARIOS)[number];

export type PlannedPunch = {
  pin: string;
  /** Device-local `YYYY-MM-DD HH:mm:ss`. */
  localDateTime: string;
  /** 0 = in, 1 = out. The processor pairs by time order. */
  statusCode: 0 | 1;
};

export type SimulatorResultLink = {
  href: string;
  label: string;
};

/** Graded scenarios show PASS/FAIL. Single punch is a summary, or an error. */
export type SimulatorCardKind = "graded" | "summary" | "error";

export type SimulatorAttendanceSnapshot = {
  date: string;
  clockIn: string;
  clockOut: string;
  hours: string;
  status: string;
  exception: string;
};

export type SimulatorResultCard = {
  scenario: SimulatorScenarioId;
  title: string;
  pass: boolean;
  /** Omitted on older cards. Treated as graded. */
  resultKind?: SimulatorCardKind;
  linesSent: number;
  accepted: number;
  duplicatesSkipped: number;
  needsReview: number;
  attendanceCreated: number;
  attendanceUpdated: number;
  reasons: string[];
  notes: string[];
  links: SimulatorResultLink[];
  attendance?: SimulatorAttendanceSnapshot | null;
  replayBody?: string;
};

export type ScenarioExpectation = {
  linesSent: number;
  accepted: number;
  duplicatesSkipped: number;
  attendanceMin: number;
  attendanceMax: number | null;
  needsReviewMin: number;
  needsReviewMax: number | null;
};

const REVIEW_NOTES = new Set([
  "missing_clock_out",
  "future_time",
  "manual_row_exists",
  "other_contract",
  "processing_error",
]);

export function simulatorScenarioTitle(scenario: SimulatorScenarioId): string {
  switch (scenario) {
    case "single_punch":
      return "Single punch";
    case "staff_group_day":
      return "Day for a staff group";
    case "offline_batch":
      return "Offline batch";
    case "resend_batch":
      return "Re-send";
    case "clock_drift":
      return "Clock drift";
    case "wrong_timezone":
      return "Wrong time zone";
    case "unknown_pin":
      return "Unknown PIN";
    case "non_attlog":
      return "Non-ATTLOG upload";
    case "heartbeat":
      return "Heartbeat burst";
  }
}

export function punchSentToNeedsReview(punch: {
  staff_id: string | null;
  process_note: string | null;
}): boolean {
  const note = (punch.process_note ?? "").trim();
  if (note.endsWith(":dismissed")) {
    return false;
  }
  if (!punch.staff_id) {
    return true;
  }
  return REVIEW_NOTES.has(note);
}

export function formatAttlogLine(punch: PlannedPunch): string {
  return `${punch.pin} ${punch.localDateTime} ${punch.statusCode} 1 ${SIMULATOR_WORK_CODE}`;
}

export function formatAttlogBody(punches: PlannedPunch[]): string {
  return punches.map(formatAttlogLine).join("\n");
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  const utc = new Date(Date.UTC(year || 1970, (month || 1) - 1, (day || 1) + days));
  return utc.toISOString().slice(0, 10);
}

export function mondayOf(isoDate: string): string {
  const day = isoDate.slice(0, 10);
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year || 1970, (month || 1) - 1, date || 1)).getUTCDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return addDays(day, delta);
}

/** Sunday of that week is before today, so none of the stamps are still in the future. */
export function weekIsPast(monday: string, todayIso: string): boolean {
  return addDays(mondayOf(monday), 6) < todayIso.slice(0, 10);
}

export function shiftLocalDateTime(
  localDateTime: string,
  deltaMinutes: number,
): string {
  const match = localDateTime
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    return localDateTime;
  }
  const date = match[1]!;
  let minutes = Number(match[2]) * 60 + Number(match[3]) + deltaMinutes;
  let dayOffset = 0;
  while (minutes < 0) {
    minutes += 24 * 60;
    dayOffset -= 1;
  }
  while (minutes >= 24 * 60) {
    minutes -= 24 * 60;
    dayOffset += 1;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${addDays(date, dayOffset)} ${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${match[4]}`;
}

export function localStamp(date: string, time: string): string {
  const clock = time.length === 5 ? `${time}:00` : time.slice(0, 8);
  return `${date.slice(0, 10)} ${clock}`;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function jitterMinutes(rng: () => number): number {
  return Math.floor(rng() * 41) - 20;
}

function rememberPunch(punches: PlannedPunch[], punch: PlannedPunch): void {
  let localDateTime = punch.localDateTime;
  while (
    punches.some(
      (row) => row.pin === punch.pin && row.localDateTime === localDateTime,
    )
  ) {
    localDateTime = shiftLocalDateTime(localDateTime, 1);
  }
  punches.push({ ...punch, localDateTime });
}

export function planSinglePunch(input: {
  pin: string;
  localDateTime: string;
  direction: "in" | "out";
}): PlannedPunch[] {
  const normalized = input.localDateTime.includes("T")
    ? input.localDateTime.replace("T", " ")
    : input.localDateTime;
  const withSeconds = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)
    ? `${normalized}:00`
    : normalized;
  return [
    {
      pin: input.pin.trim(),
      localDateTime: withSeconds,
      statusCode: input.direction === "out" ? 1 : 0,
    },
  ];
}

export function planStaffGroupDay(input: {
  date: string;
  people: { pin: string; start: string; end: string }[];
  seed: number;
}): PlannedPunch[] {
  const rng = mulberry32(input.seed);
  const punches: PlannedPunch[] = [];
  for (const person of input.people) {
    const start = localStamp(input.date, person.start);
    let end = localStamp(input.date, person.end);
    if (end <= start) {
      end = shiftLocalDateTime(end, 24 * 60);
    }
    const clockIn = shiftLocalDateTime(start, jitterMinutes(rng));
    let clockOut = shiftLocalDateTime(end, jitterMinutes(rng));
    if (clockOut <= clockIn) {
      clockOut = shiftLocalDateTime(clockIn, 60);
    }
    rememberPunch(punches, { pin: person.pin, localDateTime: clockIn, statusCode: 0 });
    rememberPunch(punches, { pin: person.pin, localDateTime: clockOut, statusCode: 1 });
  }
  return punches;
}

export function planOfflineBatch(input: {
  dates: [string, string, string];
  pins: string[];
  seed: number;
}): PlannedPunch[] {
  const rng = mulberry32(input.seed);
  const span = 31;
  let pairs = 10 + Math.floor(rng() * span);
  if (pairs > 25) {
    pairs = 25;
  }
  const punches: PlannedPunch[] = [];
  for (let index = 0; index < pairs; index += 1) {
    const pin = input.pins[index % input.pins.length]!;
    const date = input.dates[index % 3]!;
    const slot = Math.floor(index / input.pins.length);
    const start = shiftLocalDateTime(
      localStamp(date, "07:00:00"),
      slot * 20 + jitterMinutes(rng),
    );
    const end = shiftLocalDateTime(start, 4 * 60 + jitterMinutes(rng));
    rememberPunch(punches, { pin, localDateTime: start, statusCode: 0 });
    rememberPunch(punches, {
      pin,
      localDateTime: end <= start ? shiftLocalDateTime(start, 60) : end,
      statusCode: 1,
    });
  }
  return punches;
}

export function planClockDrift(input: {
  date: string;
  pin: string;
  start: string;
  end: string;
}): PlannedPunch[] {
  const start = localStamp(input.date, input.start);
  let end = localStamp(input.date, input.end);
  if (end <= start) {
    end = shiftLocalDateTime(end, 24 * 60);
  }
  return [
    {
      pin: input.pin,
      localDateTime: shiftLocalDateTime(start, 7),
      statusCode: 0,
    },
    {
      pin: input.pin,
      localDateTime: shiftLocalDateTime(end, -3),
      statusCode: 1,
    },
  ];
}

export function planWrongTimezone(input: {
  date: string;
  pin: string;
  start: string;
  end: string;
}): PlannedPunch[] {
  const start = localStamp(input.date, input.start);
  let end = localStamp(input.date, input.end);
  if (end <= start) {
    end = shiftLocalDateTime(end, 24 * 60);
  }
  return [
    {
      pin: input.pin,
      localDateTime: shiftLocalDateTime(start, 60),
      statusCode: 0,
    },
    {
      pin: input.pin,
      localDateTime: shiftLocalDateTime(end, 60),
      statusCode: 1,
    },
  ];
}

/** Unknown-PIN punches the simulator may create. Real staff PINs stay outside this range. */
export const SIMULATOR_UNKNOWN_PIN_MIN = 900000001;
export const SIMULATOR_UNKNOWN_PIN_MAX = 900000499;

export function isSimulatorUnknownPin(pin: string | null | undefined): boolean {
  const digits = (pin ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!/^\d+$/.test(digits)) {
    return false;
  }
  const value = Number(digits);
  return value >= SIMULATOR_UNKNOWN_PIN_MIN && value <= SIMULATOR_UNKNOWN_PIN_MAX;
}

/**
 * Simulator rows to delete: the DFOMS-SIM tag, plus unmapped 900000001… punches
 * (Needs review) even when work_code was not stored.
 */
export function simulatorPunchIsCleanupTarget(row: {
  work_code?: string | null;
  device_pin?: string | null;
  staff_id?: string | null;
}): boolean {
  if ((row.work_code ?? "").trim() === SIMULATOR_WORK_CODE) {
    return true;
  }
  return isSimulatorUnknownPin(row.device_pin) && !row.staff_id;
}

export function unusedSimulatorPin(existingPins: readonly string[]): string {
  const taken = new Set(
    existingPins.map((pin) => pin.replace(/\D/g, "").replace(/^0+/, "")),
  );
  for (let value = SIMULATOR_UNKNOWN_PIN_MIN; value <= SIMULATOR_UNKNOWN_PIN_MAX; value += 1) {
    if (!taken.has(String(value))) {
      return String(value);
    }
  }
  return String(SIMULATOR_UNKNOWN_PIN_MIN);
}

/**
 * Seconds to add so a second run does not reuse the same pin + punch time.
 * Unique per second for just under three hours, and always at least one second.
 */
export function simulatorRunOffsetSeconds(nowMs = Date.now()): number {
  const seconds = Math.floor(nowMs / 1000);
  return (seconds % (3 * 60 * 60 - 1)) + 1;
}

export function addSecondsToLocalDateTime(
  localDateTime: string,
  deltaSeconds: number,
): string {
  const match = localDateTime
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match || !Number.isFinite(deltaSeconds)) {
    return localDateTime;
  }
  let total =
    Number(match[2]) * 3600 +
    Number(match[3]) * 60 +
    Number(match[4]) +
    Math.trunc(deltaSeconds);
  let dayOffset = 0;
  const day = 24 * 60 * 60;
  while (total < 0) {
    total += day;
    dayOffset -= 1;
  }
  while (total >= day) {
    total -= day;
    dayOffset += 1;
  }
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${addDays(match[1]!, dayOffset)} ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

/** Shift the clock without leaving the punch's calendar date. */
export function addSecondsKeepingDate(
  localDateTime: string,
  deltaSeconds: number,
): string {
  const date = localDateTime.trim().slice(0, 10);
  const shifted = addSecondsToLocalDateTime(localDateTime, deltaSeconds);
  if (shifted.slice(0, 10) === date) {
    return shifted;
  }
  const match = localDateTime
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    return localDateTime;
  }
  const current = Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4]);
  const room = deltaSeconds >= 0 ? 24 * 60 * 60 - 1 - current : current;
  if (room <= 0) {
    const step = (Math.abs(Math.trunc(deltaSeconds)) % 120) + 1;
    const back = addSecondsToLocalDateTime(
      localDateTime,
      deltaSeconds >= 0 ? -step : step,
    );
    return back.slice(0, 10) === date ? back : localDateTime;
  }
  const within = Math.abs(Math.trunc(deltaSeconds)) % room || room;
  const kept = addSecondsToLocalDateTime(
    localDateTime,
    deltaSeconds >= 0 ? within : -within,
  );
  return kept.slice(0, 10) === date ? kept : localDateTime;
}

export const SINGLE_PUNCH_ALREADY_EXISTS =
  "This punch already exists for this time. Clean up simulated data or choose another time.";

/**
 * Single punch is the chosen date and time, with seconds :00, and no run offset.
 * An identical PIN + time is refused instead of being shifted.
 */
export function singlePunchSendPlan(input: {
  pin: string;
  localDateTime: string;
  direction: "in" | "out";
  taken?: ReadonlySet<string>;
}): { punches: PlannedPunch[] } | { error: string } {
  const punches = planSinglePunch(input);
  const punch = punches[0];
  if (!punch) {
    return { error: "Choose a date and time." };
  }
  if (input.taken?.has(`${punch.pin}|${punch.localDateTime}`)) {
    return { error: SINGLE_PUNCH_ALREADY_EXISTS };
  }
  return { punches };
}

/**
 * Clock drift and wrong time zone are sent as planned. Batch scenarios that
 * must stay unique across repeated runs still go through freshenFixedPunches.
 * Single punch never does.
 */
export function simulatorPunchesToSend(input: {
  scenario: SimulatorScenarioId;
  punches: PlannedPunch[];
  nowMs?: number;
  taken?: ReadonlySet<string>;
}): PlannedPunch[] {
  if (
    input.scenario === "single_punch" ||
    input.scenario === "clock_drift" ||
    input.scenario === "wrong_timezone" ||
    input.scenario === "resend_batch" ||
    input.scenario === "offline_batch" ||
    input.scenario === "staff_group_day"
  ) {
    return input.punches.map((punch) => ({ ...punch }));
  }
  return freshenFixedPunches({
    punches: input.punches,
    nowMs: input.nowMs,
    taken: input.taken,
  });
}

/** Batch and unknown-PIN reruns only. Single punch must not call this. */
export function freshenFixedPunches(input: {
  punches: PlannedPunch[];
  nowMs?: number;
  taken?: ReadonlySet<string>;
}): PlannedPunch[] {
  const offset = simulatorRunOffsetSeconds(input.nowMs ?? Date.now());
  const taken = new Set(input.taken ?? []);
  return input.punches.map((punch) => {
    let localDateTime = addSecondsKeepingDate(punch.localDateTime, offset);
    for (let attempt = 0; attempt < 4000; attempt += 1) {
      const key = `${punch.pin}|${localDateTime}`;
      if (!taken.has(key)) {
        taken.add(key);
        return { ...punch, localDateTime };
      }
      const next = addSecondsKeepingDate(localDateTime, 1);
      if (next === localDateTime) {
        break;
      }
      localDateTime = next;
    }
    taken.add(`${punch.pin}|${localDateTime}`);
    return { ...punch, localDateTime };
  });
}

export function planUnknownPin(date: string, pin: string): PlannedPunch[] {
  return [
    {
      pin,
      localDateTime: localStamp(date, "03:15:00"),
      statusCode: 0,
    },
  ];
}

export function nonAttlogBody(date: string): string {
  return [
    `OPLOG 0\t${date} 08:00:00\t0\t0\t0\t0`,
    "USER PIN=1\tName=Simulator\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000000000000",
  ].join("\n");
}

export function nonAttlogLineCount(body: string): number {
  return body.split(/\r?\n/).filter((line) => line.trim()).length;
}

export function attlogLinesParseAsPunches(body: string): boolean {
  return parseAttlogBody(body).length > 0;
}

export function gradeScenario(input: {
  httpOk: boolean;
  processingErrors: number;
  linesSent: number;
  accepted: number;
  duplicatesSkipped: number;
  needsReview: number;
  attendanceCreated: number;
  attendanceUpdated: number;
  expected: ScenarioExpectation;
}): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.httpOk) {
    reasons.push("The scanner endpoint did not answer OK.");
  }
  if (input.processingErrors > 0) {
    reasons.push(
      `${input.processingErrors} punch(es) were marked processing_error.`,
    );
  }
  const attendance = input.attendanceCreated + input.attendanceUpdated;
  if (input.linesSent !== input.expected.linesSent) {
    reasons.push(
      `Lines sent ${input.linesSent}, expected ${input.expected.linesSent}.`,
    );
  }
  if (input.accepted !== input.expected.accepted) {
    reasons.push(
      `Accepted ${input.accepted}, expected ${input.expected.accepted}.`,
    );
  }
  if (input.duplicatesSkipped !== input.expected.duplicatesSkipped) {
    reasons.push(
      `Duplicates skipped ${input.duplicatesSkipped}, expected ${input.expected.duplicatesSkipped}.`,
    );
  }
  if (attendance < input.expected.attendanceMin) {
    reasons.push(
      `Attendance rows touched ${attendance}, expected at least ${input.expected.attendanceMin}.`,
    );
  }
  if (
    input.expected.attendanceMax != null &&
    attendance > input.expected.attendanceMax
  ) {
    reasons.push(
      `Attendance rows touched ${attendance}, expected at most ${input.expected.attendanceMax}.`,
    );
  }
  if (input.needsReview < input.expected.needsReviewMin) {
    reasons.push(
      `Needs review ${input.needsReview}, expected at least ${input.expected.needsReviewMin}.`,
    );
  }
  if (
    input.expected.needsReviewMax != null &&
    input.needsReview > input.expected.needsReviewMax
  ) {
    reasons.push(
      `Needs review ${input.needsReview}, expected at most ${input.expected.needsReviewMax}.`,
    );
  }
  return { pass: reasons.length === 0, reasons };
}

const SINGLE_PUNCH_REJECT_NOTES = new Set([
  "processing_error",
  "manual_row_exists",
]);

/**
 * Single punch is a manual tool. Counts are reported, not graded.
 * A rejected or failed punch is an error. A stored punch is a summary,
 * including when it does not move the earliest in or latest out.
 */
export function singlePunchCardVerdict(input: {
  httpOk: boolean;
  httpDetail?: string;
  processingErrors: number;
  accepted: number;
  duplicatesSkipped: number;
  punchNotes: string[];
}): { kind: "summary" | "error"; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.httpOk) {
    reasons.push(
      input.httpDetail?.trim() || "The scanner endpoint did not answer OK.",
    );
  }
  if (input.accepted === 0 && input.duplicatesSkipped > 0) {
    reasons.push(SINGLE_PUNCH_ALREADY_EXISTS);
  } else if (input.accepted === 0 && input.httpOk && input.processingErrors === 0) {
    reasons.push("The punch was not accepted.");
  }
  const notes = [...new Set(input.punchNotes.map((note) => note.trim()).filter(Boolean))];
  for (const note of notes) {
    if (!SINGLE_PUNCH_REJECT_NOTES.has(note)) {
      continue;
    }
    const label = reviewNoteLabel({ processNote: note, staffId: "staff" });
    if (!reasons.includes(label)) {
      reasons.push(label);
    }
  }
  if (input.processingErrors > 0 && reasons.length === 0) {
    reasons.push(
      reviewNoteLabel({ processNote: "processing_error", staffId: "staff" }),
    );
  }
  return { kind: reasons.length > 0 ? "error" : "summary", reasons };
}

export function formatSimulatorClock(value: string | null | undefined): string {
  const match = (value ?? "").trim().match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "—";
}

export function formatSimulatorHours(
  value: number | string | null | undefined,
): string {
  if (value == null || value === "") {
    return "—";
  }
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) {
    return "—";
  }
  return String(Math.round(amount * 100) / 100);
}

export function simulatorAttendanceSnapshot(row: {
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  hours_worked: number | string | null;
  attendance_status: string | null;
  exception_status: string | null;
} | null): SimulatorAttendanceSnapshot | null {
  if (!row) {
    return null;
  }
  const exception = (row.exception_status ?? "").trim();
  const status = (row.attendance_status ?? "").trim();
  return {
    date: String(row.date).slice(0, 10),
    clockIn: formatSimulatorClock(row.clock_in),
    clockOut: formatSimulatorClock(row.clock_out),
    hours: formatSimulatorHours(row.hours_worked),
    status: status || "—",
    exception: exception && exception !== "none" ? exception : "none",
  };
}

/** In and out for one day. A punch inside the existing span does not fail the run. */
export function pairedDayExpectation(): ScenarioExpectation {
  return expectationForCountedScenario({
    linesSent: 2,
    accepted: 2,
    duplicatesSkipped: 0,
    attendanceMin: 0,
    attendanceMax: 1,
    needsReviewMin: 0,
    needsReviewMax: 2,
  });
}

/** One row per person at most. Unchanged earliest/latest is still a pass. */
export function staffGroupDayExpectation(
  people: number,
  punches: number,
): ScenarioExpectation {
  return expectationForCountedScenario({
    linesSent: punches,
    accepted: punches,
    duplicatesSkipped: 0,
    attendanceMin: 0,
    attendanceMax: people,
    needsReviewMin: 0,
    needsReviewMax: punches,
  });
}

/** One row per person per day at most. */
export function offlineBatchExpectation(
  linesSent: number,
  distinctRows: number,
): ScenarioExpectation {
  return expectationForCountedScenario({
    linesSent,
    accepted: linesSent,
    duplicatesSkipped: 0,
    attendanceMin: 0,
    attendanceMax: distinctRows,
    needsReviewMin: 0,
    needsReviewMax: linesSent,
  });
}

export function expectationForCountedScenario(input: {
  linesSent: number;
  accepted: number;
  duplicatesSkipped: number;
  attendanceMin: number;
  attendanceMax?: number | null;
  needsReviewMin?: number;
  needsReviewMax?: number | null;
}): ScenarioExpectation {
  return {
    linesSent: input.linesSent,
    accepted: input.accepted,
    duplicatesSkipped: input.duplicatesSkipped,
    attendanceMin: input.attendanceMin,
    attendanceMax: input.attendanceMax ?? null,
    needsReviewMin: input.needsReviewMin ?? 0,
    needsReviewMax: input.needsReviewMax ?? null,
  };
}
