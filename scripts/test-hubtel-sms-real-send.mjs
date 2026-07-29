/**
 * Real Hubtel SMS send check (mirrors utils/hubtel-sms.ts request shape).
 * Logs raw HTTP status + response body (wrapper does not expose these).
 *
 * Usage: node scripts/test-hubtel-sms-real-send.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HUBTEL_URL = "https://sms.hubtel.com/v1/messages/send";
const CONTENT = "Test message from DFOMS ERP - Hubtel integration check";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Same request as sendHubtelSms in utils/hubtel-sms.ts — returns raw HTTP details. */
async function sendHubtelSmsRaw(options) {
  const clientId = (process.env.HUBTEL_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.HUBTEL_CLIENT_SECRET ?? "").trim();
  const from =
    options.from?.trim() ||
    (process.env.HUBTEL_SMS_FROM ?? "").trim() ||
    "DAVORS";

  assert(clientId, "HUBTEL_CLIENT_ID missing");
  assert(clientSecret, "HUBTEL_CLIENT_SECRET missing");

  const to = options.to.trim();
  const content = options.content.trim();
  assert(to && content, "to and content required");

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let response;
  try {
    response = await fetch(HUBTEL_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        From: from,
        To: to,
        Content: content,
      }),
    });
  } catch (error) {
    return {
      reachedEndpoint: false,
      connectionError:
        error instanceof Error ? error.message : String(error),
      httpStatus: null,
      rawBody: null,
    };
  }

  const rawBody = await response.text().catch(() => "");
  return {
    reachedEndpoint: true,
    connectionError: null,
    httpStatus: response.status,
    rawBody,
  };
}

loadEnvForce(resolve(process.cwd(), ".env.local"));

console.log("Endpoint:", HUBTEL_URL);
console.log(
  "From:",
  (process.env.HUBTEL_SMS_FROM ?? "").trim() || "DAVORS (default)",
);
console.log("HUBTEL_CLIENT_ID present:", Boolean((process.env.HUBTEL_CLIENT_ID ?? "").trim()));
console.log(
  "HUBTEL_CLIENT_SECRET present:",
  Boolean((process.env.HUBTEL_CLIENT_SECRET ?? "").trim()),
);
console.log("");

const formats = [
  { label: "Attempt 1", to: "233244303171" },
  { label: "Attempt 2", to: "0244303171" },
];

for (const attempt of formats) {
  console.log(`=== ${attempt.label}: to=${attempt.to} ===`);
  const result = await sendHubtelSmsRaw({
    to: attempt.to,
    content: CONTENT,
  });
  console.log("reachedEndpoint:", result.reachedEndpoint);
  if (!result.reachedEndpoint) {
    console.log("connectionError:", result.connectionError);
  } else {
    console.log("httpStatus:", result.httpStatus);
    console.log("rawBody:");
    console.log(result.rawBody);
  }
  console.log("");
}
