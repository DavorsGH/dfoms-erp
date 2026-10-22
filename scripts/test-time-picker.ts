import assert from "node:assert/strict";
import {
  formatTimePickerDisplay,
  parseTimePickerText,
  timePickerPartsFromValue,
  valueFromTimePickerParts,
} from "../lib/time-picker";

assert.equal(parseTimePickerText("8:30 am"), "08:30");
assert.equal(parseTimePickerText("08:30 AM"), "08:30");
assert.equal(parseTimePickerText("0830"), "08:30");
assert.equal(parseTimePickerText("14:00"), "14:00");
assert.equal(parseTimePickerText("12:00 am"), "00:00");
assert.equal(parseTimePickerText("12:00 pm"), "12:00");
assert.equal(parseTimePickerText(""), "");
assert.equal(parseTimePickerText("25:00"), null);
assert.equal(parseTimePickerText("8:30 xm"), null);

assert.equal(formatTimePickerDisplay("08:30"), "08:30 AM");
assert.equal(formatTimePickerDisplay("00:00"), "12:00 AM");
assert.equal(formatTimePickerDisplay("12:00"), "12:00 PM");
assert.equal(formatTimePickerDisplay("17:05:00"), "05:05 PM");
assert.equal(formatTimePickerDisplay(""), "");

assert.equal(
  valueFromTimePickerParts(timePickerPartsFromValue("08:30")),
  "08:30",
);
assert.equal(
  valueFromTimePickerParts(timePickerPartsFromValue("00:15")),
  "00:15",
);
assert.equal(valueFromTimePickerParts({ hour: "08", minute: "", meridiem: "AM" }), null);

console.log("time picker tests passed");
