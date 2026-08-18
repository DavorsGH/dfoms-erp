/**
 * Unit tests for user activity log sanitization helper.
 * Usage: npx tsx scripts/test-user-activity-log-unit.ts
 */
import { sanitizeActivityMetadata } from "../utils/user-activity-log-sanitize";
import { assert } from "./lib/env";

function testStripsSensitiveKeys() {
  const result = sanitizeActivityMetadata({
    method: "password",
    password: "secret123",
    otp_code: "123456",
    failure_reason: "invalid_credentials",
    access_token: "abc",
  });
  assert(result !== null, "expected cleaned metadata");
  assert(result!.method === "password", "method preserved");
  assert(result!.failure_reason === "invalid_credentials", "failure_reason preserved");
  assert(!("password" in result!), "password stripped");
  assert(!("otp_code" in result!), "otp_code stripped");
  assert(!("access_token" in result!), "access_token stripped");
}

function testNullWhenEmpty() {
  assert(sanitizeActivityMetadata(null) === null, "null in null out");
  assert(
    sanitizeActivityMetadata({ password: "x", otp_code: "y" }) === null,
    "all sensitive keys yields null",
  );
}

function main() {
  testStripsSensitiveKeys();
  testNullWhenEmpty();
  console.log("OK: user activity log unit tests passed");
}

main();
