/**
 * Probe Hubtel account profile + message log endpoints (read-only).
 *
 *   npx tsx scripts/probe-hubtel-account-endpoints.ts --env-file .env.vercel.production.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(filePath: string) {
  for (const line of readFileSync(resolve(process.cwd(), filePath), "utf8").split(/\r?\n/)) {
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

function authHeader(): string {
  const clientId = (process.env.HUBTEL_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.HUBTEL_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET required");
  }
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function clientIdMatchLabel(clientId: string): string {
  if (clientId === "kzfuyywi") return "kzfuyywi";
  if (clientId === "npegoiax") return "npegoiax";
  return `other (${clientId.length} chars)`;
}

async function probe(url: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
  });
  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text.slice(0, 200);
  }
  return { url, status: response.status, body: parsed };
}

async function main() {
  const envFile =
    process.argv.includes("--env-file") &&
    process.argv[process.argv.indexOf("--env-file") + 1]
      ? process.argv[process.argv.indexOf("--env-file") + 1]!
      : ".env.vercel.production.local";

  loadEnv(envFile);

  const clientId = (process.env.HUBTEL_CLIENT_ID ?? "").trim();
  console.log("env file:", envFile);
  console.log("client id match:", clientIdMatchLabel(clientId));

  const sampleMessageId = "ce6f653b-aaf9-4290-bf93-991a67d054a4";
  const paths = [
    "/account/profile",
    "/account",
    "/messages",
    "/messages?limit=1&Page=1",
    `/messages/${sampleMessageId}`,
  ];
  const bases = [
    "https://sms.hubtel.com/v1",
    "https://smsc.hubtel.com/v1",
    "https://api.hubtel.com/v1",
    "https://api.hubtel.com/v1/messages",
  ] as const;

  for (const base of bases) {
    console.log(`\n=== ${base} ===`);
    const basePaths = base.endsWith("/messages") ? ["", "?limit=1"] : paths;
    for (const path of basePaths) {
      const result = await probe(`${base}${path}`);
      console.log(`${result.status} ${path || "/"}`);
      console.log(JSON.stringify(result.body, null, 2).slice(0, 800));
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
