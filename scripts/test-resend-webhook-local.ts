/**
 * Local Resend webhook smoke test (middleware + signature verification).
 *
 *   npx tsx scripts/test-resend-webhook-local.ts
 *   npx tsx scripts/test-resend-webhook-local.ts --base-url http://127.0.0.1:3000
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";

function loadEnvLocal(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    /* optional */
  }
}

function decodeSvixSecret(secret: string): Buffer {
  const trimmed = secret.trim();
  const raw = trimmed.startsWith("whsec_") ? trimmed.slice(6) : trimmed;
  return Buffer.from(raw, "base64");
}

function signSvixPayload(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  rawBody: string,
): string {
  const key = decodeSvixSecret(secret);
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const digest = createHmac("sha256", key).update(signedContent).digest("base64");
  return `v1,${digest}`;
}

async function postWebhook(
  baseUrl: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/webhooks/resend`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  const text = await response.text();
  return { status: response.status, text };
}

async function main() {
  loadEnvLocal();
  const baseUrl =
    process.argv.find((arg) => arg.startsWith("--base-url="))?.slice(11) ??
    process.argv[process.argv.indexOf("--base-url") + 1] ??
    "http://127.0.0.1:3000";

  console.log(`Base URL: ${baseUrl}\n`);

  console.log("1) Unsigned POST (expect 401 Invalid webhook signature from route):");
  const unsignedBody = JSON.stringify({ type: "email.sent", data: { email_id: "test-unsigned" } });
  const unsigned = await postWebhook(baseUrl, unsignedBody, {});
  console.log(`   HTTP ${unsigned.status}`);
  console.log(`   ${unsigned.text}\n`);

  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.log(
      "2) Skipped signed test — RESEND_WEBHOOK_SECRET not set in .env.local",
    );
    return;
  }

  console.log("2) Signed POST (expect 200 received):");
  const svixId = `msg_${Date.now()}`;
  const svixTimestamp = String(Math.floor(Date.now() / 1000));
  const signedBody = JSON.stringify({
    type: "email.sent",
    created_at: new Date().toISOString(),
    data: {
      email_id: `local-test-${Date.now()}`,
      created_at: new Date().toISOString(),
    },
  });
  const svixSignature = signSvixPayload(secret, svixId, svixTimestamp, signedBody);
  const signed = await postWebhook(baseUrl, signedBody, {
    "svix-id": svixId,
    "svix-timestamp": svixTimestamp,
    "svix-signature": svixSignature,
  });
  console.log(`   HTTP ${signed.status}`);
  console.log(`   ${signed.text}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
