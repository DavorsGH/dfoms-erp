/**
 * Live staging test: transactional SMS From/To prefix per category + OTP unchanged.
 *
 *   npx tsx scripts/test-sms-prefix-staging-live.ts --env-file .env.staging.local --phone 0244303171
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DEFAULT_PHONE = "0244303171";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const DAVORS = "00000001-0000-4000-8000-000000000001";

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

function toE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+233")) return digits;
  if (digits.startsWith("233") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length >= 10) return `+233${digits.slice(1)}`;
  if (/^\d{9}$/.test(digits)) return `+233${digits}`;
  return raw;
}

type CapturedSend = { to: string; content: string; from: string };
const capturedSends: CapturedSend[] = [];

function installFetchCapture() {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("sms.hubtel.com/v1/messages/send") && init?.body) {
      try {
        const body = JSON.parse(String(init.body)) as {
          To?: string;
          Content?: string;
          From?: string;
        };
        capturedSends.push({
          to: body.To ?? "",
          content: body.Content ?? "",
          from: body.From ?? "",
        });
      } catch {
        /* ignore */
      }
    }
    return originalFetch(input, init);
  };
}

type CategoryResult = {
  category: string;
  ok: boolean;
  messageId: string | null;
  error: string | null;
  contentSent: string | null;
  prefixOk: boolean;
  prefixDetail: string;
};

async function sendCategory(options: {
  category: string;
  to: string;
  content: string;
  tenantName?: string | null;
  recipientName?: string | null;
  purpose?: "otp" | "transactional";
  expectPrefix: boolean;
  expectedFromLine?: string;
  expectedToLine?: string;
}): Promise<CategoryResult> {
  const { sendHubtelSms } = await import("../utils/hubtel-sms");
  const beforeCount = capturedSends.length;

  const result = await sendHubtelSms({
    to: options.to,
    content: options.content,
    tenantName: options.tenantName,
    recipientName: options.recipientName,
    purpose: options.purpose,
  });

  const captured = capturedSends[beforeCount] ?? null;
  const contentSent = captured?.content ?? null;

  let prefixOk = false;
  let prefixDetail = "no capture";

  if (contentSent) {
    if (!options.expectPrefix) {
      prefixOk = !contentSent.startsWith("From:");
      prefixDetail = prefixOk
        ? "OTP body has no From: prefix"
        : `OTP body incorrectly prefixed: ${contentSent.slice(0, 80)}…`;
    } else {
      const lines = contentSent.split("\n");
      const fromLine = lines[0] ?? "";
      const toLine = lines[1] ?? "";
      const bodyStartsLine3 = lines.length >= 3;
      const fromMatch = options.expectedFromLine
        ? fromLine === options.expectedFromLine
        : fromLine.startsWith("From: ");
      const toMatch = options.expectedToLine
        ? toLine === options.expectedToLine
        : toLine.startsWith("To: ");
      prefixOk = fromMatch && toMatch && bodyStartsLine3;
      prefixDetail = `fromLine=${fromLine} | toLine=${toLine}`;
    }
  }

  return {
    category: options.category,
    ok: result.ok && prefixOk,
    messageId: result.ok ? result.id : null,
    error: result.ok ? null : result.error,
    contentSent,
    prefixOk,
    prefixDetail,
  };
}

async function main() {
  const envFile = loadEnvFromArgv(process.argv.slice(2));
  const rawPhone = parsePhone(process.argv.slice(2));

  process.env.SMS_PROVIDER = "hubtel";
  process.env.NON_OTP_SMS_ENABLED = "true";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Refusing non-staging env (${url})`);
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY missing");

  installFetchCapture();

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { resolveTenantDisplayName } = await import("../utils/tenant-display-name");
  const caantaName = await resolveTenantDisplayName(admin, CAANTA);
  const davorsName = await resolveTenantDisplayName(admin, DAVORS);

  const to = toE164(rawPhone);
  const stamp = Date.now().toString().slice(-6);

  console.log("=== SMS prefix staging live test ===");
  console.log("envFile:", envFile);
  console.log("to:", to);
  console.log("caantaName:", caantaName);
  console.log("davorsName:", davorsName);

  const categories = await Promise.all([
    sendCategory({
      category: "OTP (must be unchanged)",
      to,
      content: `Your Davors login code is ${stamp.slice(0, 6)}. It expires in 5 minutes.`,
      purpose: "otp",
      expectPrefix: false,
    }),
    sendCategory({
      category: "Client document notification",
      to,
      content: `[TEST ${stamp}] Your document is ready for review.`,
      tenantName: caantaName,
      recipientName: "Acme Trading Ltd",
      expectPrefix: true,
      expectedFromLine: `From: ${caantaName}`,
      expectedToLine: "To: Acme Trading Ltd",
    }),
    sendCategory({
      category: "RE staff alert",
      to,
      content: `[TEST ${stamp}] New lease application submitted.`,
      tenantName: davorsName,
      recipientName: "Davors RE Staff",
      expectPrefix: true,
      expectedFromLine: `From: ${davorsName}`,
      expectedToLine: "To: Davors RE Staff",
    }),
    sendCategory({
      category: "RE rent due reminder",
      to,
      content: `[TEST ${stamp}] Rent GHS 1,200.00 due on 2026-08-01.`,
      tenantName: davorsName,
      recipientName: "Jane Lessee",
      expectPrefix: true,
      expectedFromLine: `From: ${davorsName}`,
      expectedToLine: "To: Jane Lessee",
    }),
    sendCategory({
      category: "POS payment link",
      to,
      content: `[TEST ${stamp}] Davors: Pay GHS 50.00 for your POS order: https://pay.example/link`,
      tenantName: caantaName,
      recipientName: "Walk-in Customer",
      expectPrefix: true,
      expectedFromLine: `From: ${caantaName}`,
      expectedToLine: "To: Walk-in Customer",
    }),
    sendCategory({
      category: "Product sale — customer leg",
      to,
      content: `[TEST ${stamp}] Davors: Received GHS 100.00 on invoice INV-${stamp}. Balance: GHS 0.00.`,
      tenantName: caantaName,
      recipientName: "Retail Buyer",
      expectPrefix: true,
      expectedFromLine: `From: ${caantaName}`,
      expectedToLine: "To: Retail Buyer",
    }),
    sendCategory({
      category: "Product sale — owner leg",
      to,
      content: `[TEST ${stamp}] Davors: Retail Buyer paid GHS 100.00 on invoice INV-${stamp}. Balance: GHS 0.00.`,
      tenantName: caantaName,
      recipientName: "Store Manager",
      expectPrefix: true,
      expectedFromLine: `From: ${caantaName}`,
      expectedToLine: "To: Store Manager",
    }),
    sendCategory({
      category: "Employee announcement",
      to,
      content: `[TEST ${stamp}] Team meeting tomorrow at 9am.`,
      tenantName: caantaName,
      recipientName: "Kwame Employee",
      expectPrefix: true,
      expectedFromLine: `From: ${caantaName}`,
      expectedToLine: "To: Kwame Employee",
    }),
    sendCategory({
      category: "CRM campaign",
      to,
      content: `[TEST ${stamp}] Special offer this week. Reply STOP to opt out.`,
      tenantName: caantaName,
      recipientName: "Campaign Contact",
      expectPrefix: true,
      expectedFromLine: `From: ${caantaName}`,
      expectedToLine: "To: Campaign Contact",
    }),
    sendCategory({
      category: "Platform billing",
      to,
      content: `[TEST ${stamp}] Your platform subscription invoice is ready.`,
      tenantName: "Davors Facilities",
      recipientName: caantaName,
      expectPrefix: true,
      expectedFromLine: "From: Davors Facilities",
      expectedToLine: `To: ${caantaName}`,
    }),
    sendCategory({
      category: "Fallback labels (missing names)",
      to,
      content: `[TEST ${stamp}] Fallback tenant/recipient check.`,
      tenantName: null,
      recipientName: null,
      expectPrefix: true,
      expectedFromLine: "From: Davors Facilities",
      expectedToLine: "To: Customer",
    }),
  ]);

  console.log("\n=== RESULTS ===");
  let allOk = true;
  for (const r of categories) {
    const status = r.ok ? "PASS" : "FAIL";
    if (!r.ok) allOk = false;
    console.log(`\n[${status}] ${r.category}`);
    console.log("  sendOk:", r.messageId ? `id=${r.messageId}` : r.error);
    console.log("  prefix:", r.prefixOk ? "ok" : "BAD", "—", r.prefixDetail);
    if (r.contentSent) {
      const preview = r.contentSent.replace(/\n/g, "\\n").slice(0, 120);
      console.log("  body:", preview + (r.contentSent.length > 120 ? "…" : ""));
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(
    `${categories.filter((c) => c.ok).length}/${categories.length} categories passed`,
  );

  if (!allOk) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
