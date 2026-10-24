import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HIKVISION_AUTH_SUCCESS_SUB_EVENT_TYPES,
  isHikvisionAuthFailureSubEvent,
  isHikvisionAuthSuccessSubEvent,
} from "../lib/hikvision/event-codes";
import {
  extractEventTextFromFormData,
  parseHikvisionJsonText,
  parseHikvisionXmlText,
} from "../lib/hikvision/parse-event";
import {
  normalizeDevicePin,
  resolveStaffIdForDevicePin,
} from "../lib/device-pin";
import { hashPushToken } from "../lib/hikvision/push-token";

function sampleAccessEvent(overrides?: {
  subEventType?: number;
  employeeNoString?: string;
  eventType?: string;
}): string {
  return JSON.stringify({
    macAddress: "11:22:33:44:55:66",
    dateTime: "2026-10-24T08:05:00+00:00",
    eventType: overrides?.eventType ?? "AccessControllerEvent",
    AccessControllerEvent: {
      majorEventType: 5,
      subEventType: overrides?.subEventType ?? 38,
      employeeNoString: overrides?.employeeNoString ?? "0020",
      serialNo: 101,
      currentVerifyMode: "faceOrFpOrCardOrPw",
      attendanceStatus: "checkIn",
      name: "Ada",
    },
  });
}

async function testMultipartWithPicture() {
  const form = new FormData();
  form.append(
    "event_log",
    new Blob([sampleAccessEvent()], { type: "application/json" }),
  );
  form.append(
    "Picture",
    new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], {
      type: "image/jpeg",
    }),
    "Picture.jpg",
  );
  const extracted = await extractEventTextFromFormData(form);
  assert.ok(extracted);
  assert.equal(extracted!.kind, "json");
  assert.equal(extracted!.text.includes("ffd8"), false);
  const event = parseHikvisionJsonText(extracted!.text);
  assert.equal(event?.employeeNo, "0020");
  assert.equal(event?.subEventType, 38);
  assert.equal(event?.macAddress, "11:22:33:44:55:66");
}

function testJson() {
  const event = parseHikvisionJsonText(sampleAccessEvent({ subEventType: 75 }));
  assert.ok(event);
  assert.equal(event!.eventType, "AccessControllerEvent");
  assert.equal(event!.subEventType, 75);
  assert.equal(event!.serialNo, "101");
  assert.equal(isHikvisionAuthSuccessSubEvent(75), true);
}

function testXml() {
  const xml = `<?xml version="1.0"?>
<EventNotificationAlert>
  <macAddress>aa:bb:cc:dd:ee:ff</macAddress>
  <dateTime>2026-10-24T09:00:00+00:00</dateTime>
  <eventType>AccessControllerEvent</eventType>
  <majorEventType>5</majorEventType>
  <subEventType>1</subEventType>
  <employeeNoString>20</employeeNoString>
  <serialNo>7</serialNo>
</EventNotificationAlert>`;
  const event = parseHikvisionXmlText(xml);
  assert.ok(event);
  assert.equal(event!.employeeNo, "20");
  assert.equal(event!.subEventType, 1);
  assert.equal(event!.macAddress, "aa:bb:cc:dd:ee:ff");
}

function testHeartbeat() {
  const event = parseHikvisionJsonText(
    JSON.stringify({
      eventType: "heartBeat",
      macAddress: "aa:bb:cc:dd:ee:ff",
      dateTime: "2026-10-24T08:00:00+00:00",
    }),
  );
  assert.ok(event);
  assert.equal(event!.isHeartbeat, true);
}

function testFailedFingerprintIgnored() {
  assert.equal(isHikvisionAuthFailureSubEvent(39), true);
  assert.equal(isHikvisionAuthSuccessSubEvent(39), false);
}

function testUnknownSubCode() {
  assert.equal(isHikvisionAuthSuccessSubEvent(999), false);
  assert.equal(isHikvisionAuthFailureSubEvent(999), false);
}

function testLeadingZeroPinMapsToStaff() {
  const pin = normalizeDevicePin("0020");
  assert.equal(pin, "20");
  const staffId = resolveStaffIdForDevicePin("0020", [
    { staff_id: "DF0020", device_pin: "20" },
  ]);
  assert.equal(staffId, "DF0020");
}

function testDuplicateKeySemanticsDocumented() {
  const source = readFileSync("lib/hikvision/ingest-event.ts", "utf8");
  assert.equal(source.includes('insertError.code === "23505"'), true);
  const route = readFileSync(
    "app/api/attendance/hikvision/[token]/route.ts",
    "utf8",
  );
  assert.equal(route.includes("tenant_id"), true);
  assert.equal(route.includes("hashPushToken"), true);
  assert.equal(
    /from\(["']tenants["']\)|payload\.tenant|searchParams.*tenant/i.test(route),
    false,
  );
}

function testTokenHashStable() {
  const hash = hashPushToken("unit-test-token");
  assert.equal(hash.length, 64);
  assert.equal(hash, hashPushToken("unit-test-token"));
  assert.notEqual(hash, hashPushToken("other-token"));
}

function testAllowlistExports() {
  assert.equal(HIKVISION_AUTH_SUCCESS_SUB_EVENT_TYPES[1], "valid card");
  assert.equal(HIKVISION_AUTH_SUCCESS_SUB_EVENT_TYPES[38], "fingerprint pass");
  assert.equal(HIKVISION_AUTH_SUCCESS_SUB_EVENT_TYPES[75], "face pass");
}

async function main() {
  await testMultipartWithPicture();
  testJson();
  testXml();
  testHeartbeat();
  testFailedFingerprintIgnored();
  testUnknownSubCode();
  testLeadingZeroPinMapsToStaff();
  testDuplicateKeySemanticsDocumented();
  testTokenHashStable();
  testAllowlistExports();
  console.log("test-hikvision-event-parser: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
