/**
 * Unit test: device PIN normalization.
 * Usage: npx tsx scripts/test-device-pin.ts
 */
import assert from "node:assert/strict";
import {
  devicePinClashMessage,
  findDevicePinClash,
  normalizeDevicePin,
  pinFromStaffId,
  resolveStaffIdForDevicePin,
} from "../lib/device-pin";

assert.equal(pinFromStaffId("DF0020"), "20");
assert.equal(pinFromStaffId("DF0001"), "1");
assert.equal(pinFromStaffId("DF0000"), null);
assert.equal(pinFromStaffId("OFFICE"), null);
assert.equal(normalizeDevicePin("0020"), "20");
assert.equal(normalizeDevicePin("20"), "20");

const mappings = [{ staff_id: "DF0020", device_pin: "20" }];
assert.equal(resolveStaffIdForDevicePin("0020", mappings), "DF0020");
assert.equal(resolveStaffIdForDevicePin("20", mappings), "DF0020");
assert.equal(
  resolveStaffIdForDevicePin("0020", [
    { staff_id: "DF0020", device_pin: "0020" },
  ]),
  "DF0020",
);
assert.equal(resolveStaffIdForDevicePin("21", mappings), null);

const clash = findDevicePinClash("0020", "DF0099", [
  { staff_id: "DF0020", device_pin: "20", full_name: "Patience Ashie" },
]);
assert.ok(clash);
assert.equal(
  devicePinClashMessage("0020", clash!),
  "PIN 20 is already used by DF0020 Patience Ashie",
);

console.log("device pin tests passed");
