/**
 * Live Hubtel delivery test with DLR status polling (staging credentials).
 *
 *   npx tsx scripts/test-hubtel-delivery-staging-live.ts --env-file .env.staging.local --phone 0244303171
 *
 * Sends one OTP-shaped and one transactional-shaped message, then polls
 * GET https://sms.hubtel.com/v1/messages/{messageId} until terminal status.
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
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

type StatusSample = {
  at: string;
  httpStatus: number;
  status: string | null;
  raw: unknown;
};

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

function loadEnvFromArgv(argv: string[]) {
  const idx = argv.indexOf("--env-file");
  const file = idx >= 0 && argv[idx + 1] ? argv[idx + 1] : ".env.staging.local";
  loadEnvForce(resolve(process.cwd(), file));
  return file;
}

function parsePhone(argv: string[]): string {
  const idx = argv.indexOf("--phone");
  return idx >= 0 && argv[idx + 1] ? argv[idx + 1]!.trim() : DEFAULT_PHONE;
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

function resolveFrom(): string {
  return (
    (process.env.HUBTEL_SMS_FROM ?? "").trim() ||
    "DAVORS"
  );
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
  const candidates = [o.MessageId, o.messageId, (o.Data as Record<string, unknown> | undefined)?.MessageId];
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

function isDelivered(status: string | null): boolean {
  return (status ?? "").trim().toLowerCase() === "delivered";
}

async function hubtelSend(to: string, content: string, from: string) {
  const response = await fetch("https://sms.hubtel.com/v1/messages/send", {
    method: "POST",
    headers: {
      Authorization: hubtelAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ From: from, To: to, Content: content }),
  });
  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { httpStatus: response.status, parsed, text };
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

async function pollUntilTerminal(messageId: string): Promise<{
  samples: StatusSample[];
  finalStatus: string | null;
  delivered: boolean;
}> {
  const samples: StatusSample[] = [];
  const started = Date.now();

  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const result = await hubtelStatus(messageId);
    const status = extractDeliveryStatus(result.parsed);
    samples.push({
      at: new Date().toISOString(),
      httpStatus: result.httpStatus,
      status,
      raw: result.parsed,
    });
    console.log(`  [poll] ${status ?? "unknown"} (HTTP ${result.httpStatus})`);

    if (isDelivered(status) || isTerminalStatus(status)) {
      return {
        samples,
        finalStatus: status,
        delivered: isDelivered(status),
      };
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  const last = samples.at(-1);
  return {
    samples,
    finalStatus: last?.status ?? null,
    delivered: false,
  };
}

async function runMessageTest(label: string, to: string, content: string, from: string) {
  console.log(`\n=== ${label} ===`);
  console.log("To:", to);
  console.log("From:", from, `(len=${from.length})`);
  console.log("Content:", content);

  const send = await hubtelSend(to, content, from);
  console.log("Send HTTP:", send.httpStatus);
  console.log("Send body:", JSON.stringify(send.parsed, null, 2));

  const messageId = extractMessageId(send.parsed);
  assert(messageId, `${label}: no MessageId in send response`);

  console.log("MessageId:", messageId);
  console.log("Polling status (max 3 min)...");

  const poll = await pollUntilTerminal(messageId);
  console.log("Final status:", poll.finalStatus ?? "timeout");
  console.log("Delivered:", poll.delivered);

  return {
    label,
    messageId,
    sendHttp: send.httpStatus,
    sendBody: send.parsed,
    poll,
  };
}

async function main() {
  const envFile = loadEnvFromArgv(process.argv.slice(2));
  const rawPhone = parsePhone(process.argv.slice(2));

  // Force Hubtel path (ignore formula_dc if present in env).
  process.env.SMS_PROVIDER = "hubtel";
  process.env.NON_OTP_SMS_ENABLED = "true";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const projectRef = url ? new URL(url).hostname.split(".")[0] : "";
  if (projectRef && projectRef !== STAGING_REF) {
    console.warn(`Warning: env file ${envFile} is not staging ref (${projectRef})`);
  }

  const from = resolveFrom();
  const toE164Phone = toE164(rawPhone);
  const otpCode = String(Math.floor(100000 + Math.random() * 900000));

  console.log("=== Hubtel live delivery test (staging credentials) ===");
  console.log("envFile:", envFile);
  console.log("SMS_PROVIDER:", process.env.SMS_PROVIDER);
  console.log("HUBTEL_SMS_FROM:", from);
  console.log("NON_OTP_SMS_ENABLED:", process.env.NON_OTP_SMS_ENABLED);

  const otp = await runMessageTest(
    "OTP (login code shape)",
    toE164Phone,
    `Your Davors login code is ${otpCode}. It expires in 5 minutes.`,
    from,
  );

  const txn = await runMessageTest(
    "Transactional (payment receipt shape)",
    toE164Phone,
    `Davors: Received GHS 10.00 on invoice INV-TEST. Balance: GHS 0.00.`,
    from,
  );

  console.log("\n=== SUMMARY ===");
  for (const r of [otp, txn]) {
    console.log(
      `${r.label}: messageId=${r.messageId} final=${r.poll.finalStatus ?? "timeout"} delivered=${r.poll.delivered}`,
    );
  }

  const allDelivered = otp.poll.delivered && txn.poll.delivered;
  if (!allDelivered) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
