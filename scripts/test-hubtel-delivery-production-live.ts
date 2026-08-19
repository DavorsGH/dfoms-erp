/**
 * Production SMS go-live verification: OTP + transactional via Hubtel with DLR polling.
 *
 *   npx tsx scripts/test-hubtel-delivery-production-live.ts --env-file .env.vercel.production.check --phone 0244303171
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PRODUCTION_PORTAL = "portal.davorsfacilities.com";
const DEFAULT_PHONE = "0244303171";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 180_000;

const TERMINAL_STATUSES = new Set([
  "delivered",
  "blacklisted",
  "undeliverable",
  "failed",
  "unrouteable",
  "error",
  "rejected",
  "nack",
]);

const originalLoad = (
  Module as unknown as { _load: (...args: unknown[]) => unknown }
)._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load =
  function (request: unknown, parent: unknown, isMain: unknown) {
    if (request === "server-only") return {};
    return originalLoad(request, parent, isMain);
  };

function loadEnvForce(filePath: string) {
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
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hubtelAuthHeader(): string {
  const clientId = (process.env.HUBTEL_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.HUBTEL_CLIENT_SECRET ?? "").trim();
  assert(clientId && clientSecret, "HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET required");
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function toE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+233")) return digits;
  if (digits.startsWith("233") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length >= 10) return `+233${digits.slice(1)}`;
  if (/^\d{9}$/.test(digits)) return `+233${digits}`;
  return raw;
}

function extractMessageId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const candidates = [
    o.MessageId,
    o.messageId,
    (o.Data as Record<string, unknown> | undefined)?.MessageId,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "number") return String(c);
  }
  return null;
}

function extractDeliveryStatus(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const status = o.Status ?? o.status ?? o.statusDescription;
  if (typeof status === "string" && status.trim()) return status.trim();
  if (typeof status === "number") return String(status);
  return null;
}

function isDelivered(status: string | null): boolean {
  return (status ?? "").trim().toLowerCase() === "delivered";
}

function isTerminalStatus(status: string | null): boolean {
  if (!status) return false;
  const normalized = status.trim().toLowerCase();
  if (TERMINAL_STATUSES.has(normalized)) return true;
  return (
    normalized.includes("undeliverable") ||
    normalized.includes("blacklist") ||
    normalized.includes("reject") ||
    normalized.includes("fail") ||
    normalized.includes("nack") ||
    normalized.includes("unroute")
  );
}

async function hubtelStatus(messageId: string) {
  const response = await fetch(
    `https://sms.hubtel.com/v1/messages/${encodeURIComponent(messageId)}`,
    {
      method: "GET",
      headers: { Authorization: hubtelAuthHeader() },
    },
  );
  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { httpStatus: response.status, parsed, text };
}

async function pollUntilTerminal(messageId: string) {
  const samples: Array<{ at: string; status: string | null }> = [];
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const result = await hubtelStatus(messageId);
    const status = extractDeliveryStatus(result.parsed);
    samples.push({ at: new Date().toISOString(), status });
    console.log(`  [poll] ${status ?? "unknown"}`);
    if (isDelivered(status) || isTerminalStatus(status)) {
      return { finalStatus: status, delivered: isDelivered(status), samples };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return {
    finalStatus: samples.at(-1)?.status ?? null,
    delivered: false,
    samples,
  };
}

async function main() {
  const idx = process.argv.indexOf("--env-file");
  const envFile =
    idx >= 0 && process.argv[idx + 1]
      ? resolve(process.cwd(), process.argv[idx + 1]!)
      : resolve(process.cwd(), ".env.vercel.production.check");
  loadEnvForce(envFile);

  // Production go-live flags (match Vercel Production after 2026-08-18 rollout).
  process.env.SMS_PROVIDER = "hubtel";
  process.env.NON_OTP_SMS_ENABLED = "true";
  delete process.env.MFA_SMS_LOGIN_BYPASS;
  if (!process.env.NEXT_PUBLIC_SITE_URL?.includes(PRODUCTION_PORTAL)) {
    process.env.NEXT_PUBLIC_SITE_URL = `https://${PRODUCTION_PORTAL}`;
  }

  const phoneIdx = process.argv.indexOf("--phone");
  const rawPhone =
    phoneIdx >= 0 && process.argv[phoneIdx + 1]
      ? process.argv[phoneIdx + 1]!.trim()
      : DEFAULT_PHONE;

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  console.log("siteUrl:", siteUrl);

  assert(
    (process.env.SMS_PROVIDER ?? "hubtel").trim().toLowerCase() === "hubtel",
    `SMS_PROVIDER must be hubtel, got ${process.env.SMS_PROVIDER ?? "(unset)"}`,
  );
  assert(
    (process.env.NON_OTP_SMS_ENABLED ?? "").trim().toLowerCase() === "true",
    "NON_OTP_SMS_ENABLED must be true on production",
  );
  assert(
    (process.env.MFA_SMS_LOGIN_BYPASS ?? "").trim().toLowerCase() !== "true",
    "MFA_SMS_LOGIN_BYPASS must not be true on production",
  );

  process.env.SMS_PROVIDER = "hubtel";

  let formulaDcCalls = 0;
  let hubtelCalls = 0;
  const hubtelContents: string[] = [];
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("api.formula-dc.com")) formulaDcCalls += 1;
    if (url.includes("sms.hubtel.com/v1/messages/send") && init?.body) {
      hubtelCalls += 1;
      try {
        const body = JSON.parse(String(init.body)) as { Content?: string };
        if (body.Content) hubtelContents.push(body.Content);
      } catch {
        /* ignore */
      }
    }
    return originalFetch(input, init);
  };

  const { sendHubtelSms } = await import("../utils/hubtel-sms");
  const to = toE164(rawPhone);
  const otpCode = String(Math.floor(100000 + Math.random() * 900000));
  const stamp = Date.now().toString().slice(-6);

  console.log("=== Production Hubtel go-live verification ===");
  console.log("phone:", to);
  console.log("SMS_PROVIDER:", process.env.SMS_PROVIDER);
  console.log("NON_OTP_SMS_ENABLED:", process.env.NON_OTP_SMS_ENABLED);
  console.log("MFA_SMS_LOGIN_BYPASS:", process.env.MFA_SMS_LOGIN_BYPASS ?? "(unset)");

  const otpResult = await sendHubtelSms({
    to,
    content: `Your Davors login code is ${otpCode}. It expires in 5 minutes.`,
    purpose: "otp",
  });
  assert(otpResult.ok, otpResult.error ?? "OTP send failed");

  const txnResult = await sendHubtelSms({
    to,
    content: `[PROD-GO-LIVE ${stamp}] Your document is ready for review.`,
    tenantName: "Davors Facilities",
    recipientName: "David Test",
  });
  assert(txnResult.ok, txnResult.error ?? "Transactional send failed");

  assert(formulaDcCalls === 0, `Formula-DC was called ${formulaDcCalls} times`);
  assert(hubtelCalls === 2, `Expected 2 Hubtel sends, got ${hubtelCalls}`);
  assert(hubtelContents.length === 2, "Missing Hubtel content capture");
  assert(!hubtelContents[0]!.startsWith("From:"), "OTP must not have From/To prefix");
  assert(hubtelContents[1]!.startsWith("From: Davors Facilities\nTo: David Test\n"), "Transactional prefix missing");

  console.log("\nOTP Hubtel content:", hubtelContents[0]!.slice(0, 80));
  console.log("Txn Hubtel content:", hubtelContents[1]!.slice(0, 120) + "…");

  console.log("\nPolling OTP delivery…");
  const otpPoll = await pollUntilTerminal(otpResult.id!);
  console.log("OTP final:", otpPoll.finalStatus, "delivered:", otpPoll.delivered);

  console.log("\nPolling transactional delivery…");
  const txnPoll = await pollUntilTerminal(txnResult.id!);
  console.log("Txn final:", txnPoll.finalStatus, "delivered:", txnPoll.delivered);

  assert(otpPoll.delivered, `OTP not delivered: ${otpPoll.finalStatus}`);
  assert(txnPoll.delivered, `Transactional not delivered: ${txnPoll.finalStatus}`);

  console.log("\nSUMMARY: production go-live SMS verification PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
