/**
 * Live staging Formula-DC SMS adapter test (single + OTP + transactional).
 *
 *   npx tsx scripts/test-formula-dc-sms-staging-live.ts --env-file .env.staging.local --env-file .env.staging.vercel --phone 0244303171
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DEFAULT_PHONE = "0244303171";

type CapturedCall = {
  provider: "formula_dc" | "hubtel" | "other";
  url: string;
  requestBody: unknown;
  responseStatus: number;
  responseBody: unknown;
};

const captured: CapturedCall[] = [];
let hubtelCallCount = 0;
let formulaDcCallCount = 0;

const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  let provider: CapturedCall["provider"] = "other";
  if (url.includes("api.formula-dc.com")) {
    provider = "formula_dc";
    formulaDcCallCount += 1;
  } else if (url.includes("sms.hubtel.com")) {
    provider = "hubtel";
    hubtelCallCount += 1;
  }

  const response = await originalFetch(input, init);
  const clone = response.clone();
  let responseBody: unknown = null;
  const text = await clone.text().catch(() => "");
  try {
    responseBody = text ? JSON.parse(text) : null;
  } catch {
    responseBody = text;
  }

  let requestBody: unknown = null;
  if (init?.body && typeof init.body === "string") {
    try {
      requestBody = JSON.parse(init.body);
    } catch {
      requestBody = init.body;
    }
  }

  if (provider !== "other") {
    captured.push({
      provider,
      url,
      requestBody,
      responseStatus: response.status,
      responseBody,
    });
  }

  return response;
};

const originalLoad = (
  Module as unknown as { _load: (...args: unknown[]) => unknown }
)._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load =
  function (request: unknown, parent: unknown, isMain: unknown) {
    if (request === "server-only") return {};
    return originalLoad(request, parent, isMain);
  };

function loadEnvFile(filePath: string) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), filePath), "utf8").split(
      /\r?\n/,
    )) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      process.env[t.slice(0, i).trim()] = v;
    }
  } catch {
    // optional env file
  }
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const envFiles: string[] = [];
  let phone = DEFAULT_PHONE;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--env-file" && argv[i + 1]) {
      envFiles.push(argv[++i]!);
    } else if (argv[i] === "--phone" && argv[i + 1]) {
      phone = argv[++i]!;
    }
  }
  if (envFiles.length === 0) {
    envFiles.push(".env.staging.local", ".env.staging.vercel");
  }
  return { envFiles, phone };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function maskSecret(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "(missing)";
  return `${v.slice(0, 4)}… (${v.length} chars)`;
}

async function main() {
  const { envFiles, phone } = parseArgs();
  for (const file of envFiles) loadEnvFile(file);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes(STAGING_REF), `Refusing: expected staging ref ${STAGING_REF}`);

  process.env.SMS_PROVIDER = process.env.SMS_PROVIDER?.trim() || "formula_dc";

  console.log("=== Formula-DC live staging SMS test ===\n");
  console.log("SMS_PROVIDER:", process.env.SMS_PROVIDER);
  console.log("FORMULA_DC_SENDER_ID:", process.env.FORMULA_DC_SENDER_ID ?? "(default Davors-ERP)");
  console.log("FORMULA_DC_API_KEY:", maskSecret(process.env.FORMULA_DC_API_KEY));
  console.log("NON_OTP_SMS_ENABLED:", process.env.NON_OTP_SMS_ENABLED ?? "(unset)");
  console.log("Test phone (raw):", phone);

  const { toFormulaDcRecipient } = await import("../utils/formula-dc-sms");
  const normalized = toFormulaDcRecipient(phone);
  console.log("Formula-DC recipient (normalized):", normalized ?? "(invalid)");
  assert(normalized, "Phone normalization failed");

  const { resolveSmsProvider } = await import("../utils/sms-provider");
  assert(resolveSmsProvider() === "formula_dc", "SMS_PROVIDER must resolve to formula_dc");

  const { isNonOtpSmsSendingEnabled } = await import("../utils/sms-shared");
  console.log("isNonOtpSmsSendingEnabled():", isNonOtpSmsSendingEnabled());

  const { sendHubtelSms } = await import("../utils/hubtel-sms");

  const otpCode = String(Math.floor(100000 + Math.random() * 900000));
  console.log("\n--- 1) OTP send (purpose=otp) ---");
  const otpResult = await sendHubtelSms({
    to: phone,
    content: `Davors Formula-DC OTP staging test ${otpCode}. Expires in 5 minutes.`,
    purpose: "otp",
  });
  console.log("SendSmsResult:", otpResult);

  const otpCall = captured.find((c) => c.provider === "formula_dc");
  assert(otpCall, "Expected Formula-DC API call for OTP");
  const otpBody = otpCall.requestBody as Record<string, unknown>;
  console.log("OTP request body:", JSON.stringify(otpBody, null, 2));
  console.log("OTP API response:", JSON.stringify(otpCall.responseBody, null, 2));

  assert(otpBody.message_type === "OTP", "OTP request must include message_type OTP");
  assert(otpBody.sender_id === "Davors-ERP", 'OTP sender_id must be "Davors-ERP"');
  assert(otpBody.to === normalized, "OTP to must match normalized recipient");
  assert(otpResult.ok, otpResult.ok ? "" : otpResult.error);

  console.log("\n--- 2) Transactional send (default purpose) ---");
  if (!isNonOtpSmsSendingEnabled()) {
    console.warn("WARN: NON_OTP_SMS_ENABLED is not true — transactional send may be suppressed");
  }

  const txnResult = await sendHubtelSms({
    to: phone,
    content: `Davors Formula-DC transactional staging test at ${new Date().toISOString()}`,
  });
  console.log("SendSmsResult:", txnResult);

  const txnCalls = captured.filter((c) => c.provider === "formula_dc");
  const txnCall = txnCalls.at(-1);
  assert(txnCall, "Expected Formula-DC API call for transactional");
  const txnBody = txnCall.requestBody as Record<string, unknown>;
  console.log("Transactional request body:", JSON.stringify(txnBody, null, 2));
  console.log("Transactional API response:", JSON.stringify(txnCall.responseBody, null, 2));

  assert(!("message_type" in txnBody), "Transactional must not include message_type");
  assert(txnBody.sender_id === "Davors-ERP", 'Transactional sender_id must be "Davors-ERP"');
  assert(txnBody.to === normalized, "Transactional to must match normalized recipient");
  assert(txnResult.ok, txnResult.ok ? "" : txnResult.error);

  console.log("\n--- Summary ---");
  console.log("Formula-DC API calls:", formulaDcCallCount);
  console.log("Hubtel API calls:", hubtelCallCount);
  assert(hubtelCallCount === 0, "Hubtel must not be called when SMS_PROVIDER=formula_dc");
  assert(formulaDcCallCount === 2, "Expected exactly 2 Formula-DC calls");

  console.log("\nPASS — OTP + transactional Formula-DC live sends completed.");
  console.log("Please confirm both SMS messages arrived on the handset.");
}

main().catch((error) => {
  console.error("\nFAIL —", error instanceof Error ? error.message : error);
  console.error("\nCaptured provider calls:", JSON.stringify(captured, null, 2));
  console.error("Hubtel calls:", hubtelCallCount, "Formula-DC calls:", formulaDcCallCount);
  process.exit(1);
});
