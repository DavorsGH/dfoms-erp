import assert from "node:assert/strict";
import {
  describeShiftLength,
  shiftClockFromTime,
  timeFromShiftClock,
} from "../lib/shift-attendance";

assert.equal(
  timeFromShiftClock(shiftClockFromTime("06:00:00")),
  "06:00",
);
assert.equal(
  timeFromShiftClock(shiftClockFromTime("14:00:00")),
  "14:00",
);
assert.equal(
  timeFromShiftClock(shiftClockFromTime("22:00:00")),
  "22:00",
);
assert.equal(timeFromShiftClock({ hour: "", minute: "", meridiem: "" }), null);
assert.equal(
  timeFromShiftClock({ hour: "06", minute: "", meridiem: "AM" }),
  null,
);

const morning = describeShiftLength("Morning", "06:00", "14:00");
assert.equal(morning?.minutes, 8 * 60);
assert.equal(morning?.hoursLabel, "8h 00m");
assert.equal(morning?.warn, false);
assert.equal(morning?.crossesMidnight, false);

const night = describeShiftLength("Night", "22:00", "06:00");
assert.equal(night?.minutes, 8 * 60);
assert.equal(night?.hoursLabel, "8h 00m");
assert.equal(night?.warn, false);
assert.equal(night?.lengthLabel, "8h 00m · overnight");

const swapped = describeShiftLength("Morning", "18:00", "14:00");
assert.equal(swapped?.minutes, 20 * 60);
assert.equal(swapped?.warn, true);
assert.equal(swapped?.crossesMidnight, true);
assert.match(swapped?.warningSentence ?? "", /6:00 PM → 2:00 PM/);
assert.match(swapped?.warningSentence ?? "", /20h 00m/);
assert.match(swapped?.warningSentence ?? "", /crosses midnight/);

console.log("shift clock ok");
