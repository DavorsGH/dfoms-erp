/**
 * Shift times drafts keep TimePicker HH:mm values through edit and save payload.
 * Usage: npx tsx scripts/test-shift-times-time-picker.ts
 */
import assert from "node:assert/strict";
import {
  formatTimePickerDisplay,
  parseTimePickerText,
  timePickerPartsFromValue,
  valueFromTimePickerParts,
} from "../lib/time-picker";
import { timeInputValue } from "../lib/shift-attendance";

type Draft = { start: string; end: string; late: string; early: string };

function emptyDraft(): Draft {
  return { start: "", end: "", late: "", early: "" };
}

/** Mirrors ShiftTimesCard updateDraft for one shift row. */
function applyTimePickerChange(draft: Draft, field: "start" | "end", raw: string): Draft {
  // TimePickerField always commits 24-hour HH:mm (or "").
  return { ...draft, [field]: raw };
}

function savePayload(draft: Draft): { start_time: string; end_time: string } | null {
  if (!draft.start || !draft.end) {
    return null;
  }
  return {
    start_time: `${draft.start}:00`,
    end_time: `${draft.end}:00`,
  };
}

// Empty stays empty — never default to 08:00.
let row = emptyDraft();
assert.equal(row.start, "");
assert.equal(formatTimePickerDisplay(row.start), "");
assert.equal(valueFromTimePickerParts(timePickerPartsFromValue("")), null);

// Pick 04:30 then 15:30 on Start / End (as the picker commits HH:mm).
row = applyTimePickerChange(row, "start", "04:30");
row = applyTimePickerChange(row, "end", "15:30");
assert.equal(row.start, "04:30");
assert.equal(row.end, "15:30");
assert.equal(formatTimePickerDisplay(row.start), "04:30 AM");
assert.equal(formatTimePickerDisplay(row.end), "03:30 PM");

const payload = savePayload(row);
assert.ok(payload);
assert.equal(payload.start_time, "04:30:00");
assert.equal(payload.end_time, "15:30:00");

// Typed forms the field accepts also land on the same HH:mm.
assert.equal(parseTimePickerText("4:30 am"), "04:30");
assert.equal(parseTimePickerText("0430"), "04:30");
assert.equal(parseTimePickerText("16:00"), "16:00");
assert.equal(parseTimePickerText("15:30"), "15:30");

// Round-trip through the parts the OK button uses.
assert.equal(
  valueFromTimePickerParts(timePickerPartsFromValue("04:30")),
  "04:30",
);
assert.equal(
  valueFromTimePickerParts(timePickerPartsFromValue("15:30")),
  "15:30",
);

// Loading a saved row still uses HH:mm without inventing 08:00 for blanks.
assert.equal(timeInputValue("04:30:00"), "04:30");
assert.equal(timeInputValue("15:30:00"), "15:30");
assert.equal(timeInputValue(""), "");
assert.equal(timeInputValue(null), "");

console.log("OK: shift times time-picker persistence tests passed");
