/**
 * Full Redis walkthrough for escalating SMS resend policy (staging/production Upstash).
 *
 * Usage:
 *   npx tsx scripts/test-sms-resend-rate-limit-redis-staging.ts
 *
 * Loads Upstash from .env.vercel.production.local (preview env often lacks Upstash).
 * Uses a disposable test auth UID — does not touch real accounts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { formatSmsResendRateLimitMessage } from "../lib/mfa/format-sms-resend-wait";
import {
  evaluateSmsResendGate,
  SMS_RESEND_BACKOFF_MINUTES,
} from "../lib/mfa/sms-resend-rate-limit";

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

function loadUpstashEnv() {
  for (const file of [".env.vercel.production.local", ".env.vercel.preview.local"]) {
    loadEnvFile(resolve(process.cwd(), file));
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim() ?? "";
    if (url.startsWith("https://")) {
      return file;
    }
  }
  throw new Error(
    "Upstash not configured. Run: npx vercel env pull .env.vercel.production.local --environment=production",
  );
}

async function main() {
  const envFile = loadUpstashEnv();
  console.log(`Using Upstash from ${envFile}`);

  const {
    assertMfaResendAllowed,
    recordMfaResend,
    resetMfaResendStateForAccount,
    smsResendRedisKey,
  } = await import("../lib/mfa/sms-resend-rate-limit-store");

  const authUid = `staging-test-${randomUUID()}`;
  console.log(`Disposable auth UID: ${authUid}\n`);

  await resetMfaResendStateForAccount(authUid);

  // --- Escalating backoff via real Redis record/assert cycles ---
  let step = await assertMfaResendAllowed(authUid);
  assert(step.ok, "send 1: allowed");
  await recordMfaResend(authUid);
  console.log("PASS send 1 — immediate");

  const backoffChecks = [
    { send: 2, minSeconds: 55, maxSeconds: 60, label: "1 minute" },
    { send: 3, minSeconds: 115, maxSeconds: 120, label: "2 minutes" },
    { send: 4, minSeconds: 295, maxSeconds: 300, label: "5 minutes" },
    { send: 5, minSeconds: 595, maxSeconds: 600, label: "10 minutes" },
  ];

  for (const check of backoffChecks) {
    step = await assertMfaResendAllowed(authUid);
    assert(!step.ok, `send ${check.send}: blocked immediately after prior send`);
    if (!step.ok) {
      const msg = formatSmsResendRateLimitMessage(step.resendAvailableInSeconds);
      console.log(
        `PASS send ${check.send} early block — ${step.resendAvailableInSeconds}s (${check.label}) → "${msg}"`,
      );
      assert(
        step.resendAvailableInSeconds >= check.minSeconds &&
          step.resendAvailableInSeconds <= check.maxSeconds,
        `send ${check.send}: expected ~${check.label}, got ${step.resendAvailableInSeconds}s`,
      );
    }

    // Simulate elapsed backoff by rewriting the latest timestamp in Redis.
    const { Redis } = await import("@upstash/redis");
    const redis = Redis.fromEnv();
    const raw = await redis.get<{ sends: number[] }>(smsResendRedisKey(authUid));
    const sends = raw?.sends ?? [];
    const backoffMinutes =
      SMS_RESEND_BACKOFF_MINUTES[sends.length - 1] ?? 0;
    const shifted = sends.map((timestamp, index) =>
      index === sends.length - 1
        ? Date.now() - backoffMinutes * 60_000 - 500
        : timestamp,
    );
    await redis.set(smsResendRedisKey(authUid), { sends: shifted }, { ex: 960 });

    step = await assertMfaResendAllowed(authUid);
    assert(step.ok, `send ${check.send}: allowed after ${check.label} elapsed`);
    await recordMfaResend(authUid);
    console.log(`PASS send ${check.send} — allowed after ${check.label}`);
  }

  // --- Cap blocks 6th even when backoff would allow ---
  await resetMfaResendStateForAccount(authUid);
  const now = Date.now();
  const packedSends = [
    now - 14 * 60_000,
    now - 13 * 60_000,
    now - 12 * 60_000,
    now - 11 * 60_000,
    now - 10 * 60_000,
  ];
  const { Redis } = await import("@upstash/redis");
  const redis = Redis.fromEnv();
  await redis.set(smsResendRedisKey(authUid), { sends: packedSends }, { ex: 960 });

  step = await assertMfaResendAllowed(authUid);
  assert(!step.ok, "6th send blocked with 5 in rolling window");
  if (!step.ok) {
    const capGate = evaluateSmsResendGate(packedSends, now);
    assert(!capGate.allowed && capGate.blockReason === "cap", "block reason should be cap");
    const msg = formatSmsResendRateLimitMessage(step.resendAvailableInSeconds);
    console.log(
      `PASS cap — 6th blocked despite 10m+ since 5th: ${step.resendAvailableInSeconds}s → "${msg}"`,
    );
    assert(
      step.resendAvailableInSeconds > 60,
      "cap wait should exceed any single backoff gap",
    );
  }

  // After 5th timestamp ages out of window, allow again.
  const afterWindow = packedSends[0]! + 15 * 60_000 + 1_000;
  const rollover = evaluateSmsResendGate(packedSends, afterWindow);
  assert(rollover.allowed === true, "window rollover allows sends again");

  await resetMfaResendStateForAccount(authUid);
  console.log("\nAll staging Redis policy checks passed.");
}

main().catch((error) => {
  console.error("FAIL —", error instanceof Error ? error.message : error);
  process.exit(1);
});
