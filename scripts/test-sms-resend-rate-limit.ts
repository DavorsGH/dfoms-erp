/**
 * Unit + optional Redis integration tests for SMS resend rate limiting.
 *
 * Usage:
 *   npx tsx scripts/test-sms-resend-rate-limit.ts
 *   npx tsx scripts/test-sms-resend-rate-limit.ts --redis --auth-uid <uuid>
 */
import { resolve } from "node:path";
import { loadEnvForce } from "./lib/env";
import {
  evaluateSmsResendGate,
  SMS_RESEND_BACKOFF_MINUTES,
  SMS_RESEND_MAX_SENDS,
  SMS_RESEND_WINDOW_MS,
  describeSmsResendSchedule,
} from "../lib/mfa/sms-resend-rate-limit";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function minutes(ms: number): number {
  return ms / 60_000;
}

function runUnitTests() {
  const t0 = 1_700_000_000_000;

  assert(evaluateSmsResendGate([], t0).allowed === true, "empty allows send");

  let sends = [t0];
  let gate = evaluateSmsResendGate(sends, t0 + 30_000);
  assert(!gate.allowed && gate.blockReason === "backoff", "2nd send blocked at 30s");
  if (!gate.allowed) {
    assert(
      gate.resendAvailableInSeconds === 30,
      `expected 30s backoff remainder, got ${gate.resendAvailableInSeconds}`,
    );
  }

  gate = evaluateSmsResendGate(sends, t0 + 60_000);
  assert(gate.allowed === true, "2nd send allowed after 1 minute");

  sends = [t0, t0 + 60_000];
  gate = evaluateSmsResendGate(sends, t0 + 60_000 + 60_000);
  assert(!gate.allowed && gate.blockReason === "backoff", "3rd send blocked at 1m after 2nd");
  if (!gate.allowed) {
    assert(
      gate.resendAvailableInSeconds === 60,
      `expected 60s until 3rd, got ${gate.resendAvailableInSeconds}`,
    );
  }

  gate = evaluateSmsResendGate(sends, t0 + 60_000 + 2 * 60_000);
  assert(gate.allowed === true, "3rd send allowed after 2 minutes");

  sends = [t0, t0 + 60_000, t0 + 3 * 60_000];
  gate = evaluateSmsResendGate(sends, t0 + 3 * 60_000 + 4 * 60_000);
  assert(!gate.allowed && gate.blockReason === "backoff", "4th send blocked before 5m gap");
  if (!gate.allowed) {
    assert(
      gate.resendAvailableInSeconds === 60,
      `expected 60s until 4th, got ${gate.resendAvailableInSeconds}`,
    );
  }

  gate = evaluateSmsResendGate(sends, t0 + 3 * 60_000 + 5 * 60_000);
  assert(gate.allowed === true, "4th send allowed after 5 minutes");

  sends = [
    t0,
    t0 + 60_000,
    t0 + 3 * 60_000,
    t0 + 8 * 60_000,
  ];
  gate = evaluateSmsResendGate(sends, t0 + 8 * 60_000 + 5 * 60_000);
  assert(!gate.allowed && gate.blockReason === "backoff", "5th send blocked before 10m gap");
  if (!gate.allowed) {
    assert(
      gate.resendAvailableInSeconds === 5 * 60,
      `expected 5m until 5th, got ${gate.resendAvailableInSeconds}`,
    );
  }

  gate = evaluateSmsResendGate(sends, t0 + 8 * 60_000 + 10 * 60_000);
  assert(gate.allowed === true, "5th send allowed after 10 minutes");

  sends = [
    t0,
    t0 + 60_000,
    t0 + 3 * 60_000,
    t0 + 8 * 60_000,
    t0 + 18 * 60_000,
  ];
  gate = evaluateSmsResendGate(sends, t0 + 18 * 60_000 + 1);
  assert(
    !gate.allowed && gate.blockReason === "backoff",
    "immediate resend after 5th is still blocked by escalating backoff",
  );

  // Cap safety net: five sends packed inside one rolling window (abuse / bypass path).
  const packed = [
    t0,
    t0 + 60_000,
    t0 + 2 * 60_000,
    t0 + 3 * 60_000,
    t0 + 4 * 60_000,
  ];
  gate = evaluateSmsResendGate(packed, t0 + 4 * 60_000 + 1);
  assert(!gate.allowed && gate.blockReason === "cap", "6th attempt blocked by cap");
  if (!gate.allowed) {
    const expectedCapWait = Math.ceil(
      (t0 + SMS_RESEND_WINDOW_MS - (t0 + 4 * 60_000 + 1)) / 1000,
    );
    assert(
      gate.resendAvailableInSeconds === expectedCapWait,
      `cap wait expected ${expectedCapWait}, got ${gate.resendAvailableInSeconds}`,
    );
  }

  gate = evaluateSmsResendGate(packed, t0 + SMS_RESEND_WINDOW_MS + 1);
  assert(gate.allowed === true, "window rollover allows again after packed cap");

  console.log("PASS — unit tests");
  console.log("\nSchedule implemented:");
  console.log(describeSmsResendSchedule());
  console.log(
    `\nConstants: max=${SMS_RESEND_MAX_SENDS}, window=${minutes(SMS_RESEND_WINDOW_MS)}m, backoff=[${SMS_RESEND_BACKOFF_MINUTES.join(", ")}] minutes`,
  );
}

async function runRedisIntegration(authUid: string) {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  loadEnvForce(resolve(process.cwd(), ".env.local"));

  const {
    assertMfaResendAllowed,
    recordMfaResend,
    resetMfaResendStateForAccount,
  } = await import("../lib/mfa/mfa-rate-limit");

  if (
    !process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  ) {
    console.log("SKIP — Upstash not configured locally (set env or use Vercel preview)");
    return;
  }

  await resetMfaResendStateForAccount(authUid);

  const first = await assertMfaResendAllowed(authUid);
  assert(first.ok === true, "redis: first send allowed");

  await recordMfaResend(authUid);
  const secondEarly = await assertMfaResendAllowed(authUid);
  assert(secondEarly.ok === false, "redis: immediate 2nd blocked");
  if (!secondEarly.ok) {
    console.log(
      `  2nd early block: ${secondEarly.resendAvailableInSeconds}s (${Math.round(secondEarly.resendAvailableInSeconds / 60)}m)`,
    );
  }

  await resetMfaResendStateForAccount(authUid);
  console.log("PASS — redis integration smoke");
}

async function main() {
  runUnitTests();

  const redisFlag = process.argv.includes("--redis");
  const authUidIdx = process.argv.indexOf("--auth-uid");
  const authUid = authUidIdx >= 0 ? process.argv[authUidIdx + 1] : undefined;

  if (redisFlag && authUid) {
    await runRedisIntegration(authUid);
  } else if (redisFlag) {
    console.log("\nTip: pass --auth-uid <uuid> for Redis integration smoke test");
  }
}

main().catch((error) => {
  console.error("FAIL —", error instanceof Error ? error.message : error);
  process.exit(1);
});
