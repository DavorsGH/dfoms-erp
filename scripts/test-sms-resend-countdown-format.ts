/**
 * Unit tests for SMS resend countdown formatters and resendAvailableAtMs gate field.
 *
 * Usage: npx tsx scripts/test-sms-resend-countdown-format.ts
 */
import {
  formatSmsResendCountdownClock,
  formatSmsResendRateLimitLiveMessage,
  isSmsResendRateLimited,
} from "../lib/mfa/format-sms-resend-wait";
import { evaluateSmsResendGate } from "../lib/mfa/sms-resend-rate-limit";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function runFormatterTests() {
  assert(formatSmsResendCountdownClock(119) === "1:59", "1:59");
  assert(formatSmsResendCountdownClock(60) === "1:00", "1:00");
  assert(formatSmsResendCountdownClock(59) === "0:59", "0:59");
  assert(formatSmsResendCountdownClock(1) === "0:01", "0:01");
  assert(formatSmsResendCountdownClock(0) === "0:00", "0:00");

  assert(
    formatSmsResendRateLimitLiveMessage(90) ===
      "Too many SMS requests. Try again in 1:30.",
    "live message 1:30",
  );
  assert(
    formatSmsResendRateLimitLiveMessage(45) ===
      "Too many SMS requests. Try again in 0:45.",
    "live message 0:45",
  );

  assert(
    isSmsResendRateLimited({
      ok: false,
      error: "blocked",
      resendAvailableAtMs: Date.now() + 60_000,
    }),
    "rate limited when resendAvailableAtMs set",
  );
  assert(
    !isSmsResendRateLimited({ ok: false, error: "other error" }),
    "not rate limited without timestamp",
  );
  assert(!isSmsResendRateLimited({ ok: true }), "ok result not rate limited");

  console.log("PASS — formatter tests");
}

function runAtMsTests() {
  const t0 = 1_700_000_000_000;
  const sends = [t0];
  const nowMs = t0 + 30_000;
  const gate = evaluateSmsResendGate(sends, nowMs);

  assert(!gate.allowed && gate.blockReason === "backoff", "blocked for backoff");
  if (!gate.allowed) {
    const expectedAt = t0 + 60_000;
    assert(
      gate.resendAvailableAtMs === expectedAt,
      `expected resendAvailableAtMs=${expectedAt}, got ${gate.resendAvailableAtMs}`,
    );
    assert(
      gate.resendAvailableInSeconds === Math.ceil((expectedAt - nowMs) / 1000),
      "seconds consistent with atMs",
    );
  }

  const packed = [t0, t0 + 60_000, t0 + 2 * 60_000, t0 + 3 * 60_000, t0 + 4 * 60_000];
  const capGate = evaluateSmsResendGate(packed, t0 + 4 * 60_000 + 1);
  assert(!capGate.allowed && capGate.blockReason === "cap", "cap block");
  if (!capGate.allowed) {
    assert(
      capGate.resendAvailableAtMs === t0 + 15 * 60_000,
      `cap reset at window end, got ${capGate.resendAvailableAtMs}`,
    );
  }

  console.log("PASS — resendAvailableAtMs tests");
}

runFormatterTests();
runAtMsTests();
