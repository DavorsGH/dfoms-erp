/**
 * Redis integration walkthrough for SMS resend limiter (staging/preview Upstash).
 *
 * Usage:
 *   npx tsx scripts/test-sms-resend-rate-limit-redis-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { formatSmsResendRateLimitMessage } from "../lib/mfa/format-sms-resend-wait";

function loadEnvFile(filePath: string) {
  try {
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const i = trimmed.indexOf("=");
      if (i === -1) continue;
      let value = trimmed.slice(i + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[trimmed.slice(0, i).trim()] = value;
    }
  } catch {
    // optional file
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.vercel.preview.local"));

  if (
    !process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  ) {
    throw new Error("Upstash env missing in .env.vercel.preview.local");
  }

  const {
    assertMfaResendAllowed,
    recordMfaResend,
    resetMfaResendStateForAccount,
    smsResendRedisKey,
  } = await import("../lib/mfa/sms-resend-rate-limit-store");

  const authUid = `test-${randomUUID()}`;
  console.log(`Using disposable test auth UID: ${authUid}`);

  await resetMfaResendStateForAccount(authUid);

  let step = await assertMfaResendAllowed(authUid);
  assert(step.ok, "step 1: first send allowed");
  await recordMfaResend(authUid);
  console.log("PASS step 1 — 1st send recorded (immediate)");

  step = await assertMfaResendAllowed(authUid);
  assert(!step.ok, "step 2: immediate 2nd blocked");
  if (!step.ok) {
    const msg = formatSmsResendRateLimitMessage(step.resendAvailableInSeconds);
    console.log(
      `PASS step 2 — backoff ~1m: ${step.resendAvailableInSeconds}s → "${msg}"`,
    );
    assert(
      step.resendAvailableInSeconds >= 55 && step.resendAvailableInSeconds <= 60,
      `expected ~60s wait, got ${step.resendAvailableInSeconds}`,
    );
  }

  // Cap safety: inject five sends inside one window.
  await resetMfaResendStateForAccount(authUid);
  const now = Date.now();
  const { Redis } = await import("@upstash/redis");
  const redis = Redis.fromEnv();
  const packed = {
    sends: [
      now - 4 * 60_000,
      now - 3 * 60_000,
      now - 2 * 60_000,
      now - 60_000,
      now - 1_000,
    ],
  };
  await redis.set(smsResendRedisKey(authUid), packed, { ex: 960 });

  step = await assertMfaResendAllowed(authUid);
  assert(!step.ok, "cap: 6th send blocked with 5 in window");
  if (!step.ok) {
    const msg = formatSmsResendRateLimitMessage(step.resendAvailableInSeconds);
    console.log(
      `PASS cap — window reset: ${step.resendAvailableInSeconds}s → "${msg}"`,
    );
    assert(
      step.resendAvailableInSeconds > 60,
      "cap wait should be well over 1 minute",
    );
  }

  await resetMfaResendStateForAccount(authUid);
  console.log("\nAll Redis integration checks passed on preview Upstash.");
}

main().catch((error) => {
  console.error("FAIL —", error instanceof Error ? error.message : error);
  process.exit(1);
});
