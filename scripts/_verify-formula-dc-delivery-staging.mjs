/**
 * Staging Formula-DC delivery verification:
 * 1) status probe for existing message_ids
 * 2) fresh OTP + transactional sends
 * 3) wait
 * 4) status probe for new message_ids
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const STAGING_APP_URL =
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app";
const BYPASS = "IJ7aYbMjtmTzXvZFVY1MdDdZYAlZcIDq";
const WAIT_MS = 3 * 60 * 1000;

const PRIOR_IDS = [
  "4fe23a8d-d608-456f-88fb-04d58ca2cbcc",
  "33059da9-9b64-4b0a-a6ae-219ac43e0387",
];

function loadCronSecret() {
  for (const line of readFileSync(
    resolve(process.cwd(), ".env.staging.local"),
    "utf8",
  ).split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("CRON_SECRET=")) {
      let v = t.slice(12).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      return v;
    }
  }
  throw new Error("CRON_SECRET missing");
}

async function stagingFetch(path, init = {}) {
  const cronSecret = loadCronSecret();
  const headers = {
    Authorization: `Bearer ${cronSecret}`,
    "x-vercel-protection-bypass": BYPASS,
    ...(init.headers ?? {}),
  };
  const res = await fetch(`${STAGING_APP_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 2000) };
  }
  return { status: res.status, body };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function summarizeStatusProbe(result) {
  return {
    messageId: result.messageId,
    resolvedStatus: result.resolvedStatus,
    bestProbe: result.bestProbe
      ? {
          url: result.bestProbe.url,
          httpStatus: result.bestProbe.httpStatus,
          body: result.bestProbe.body,
        }
      : null,
    probeSummary: result.probes.map((p) => ({
      url: p.url.replace("https://api.formula-dc.com", ""),
      httpStatus: p.httpStatus,
      status: extractStatus(p.body),
    })),
  };
}

function extractStatus(body) {
  if (!body || typeof body !== "object") return null;
  const root = body;
  const data = root.data && typeof root.data === "object" ? root.data : root;
  for (const key of ["status", "delivery_status", "message_status", "state"]) {
    if (typeof data[key] === "string") return data[key];
  }
  return null;
}

async function main() {
  const phone = process.argv.includes("--phone")
    ? process.argv[process.argv.indexOf("--phone") + 1]
    : "0541400004";

  console.log("=== Formula-DC delivery verification ===");
  console.log("Phone:", phone);
  console.log("Prior message_ids:", PRIOR_IDS.join(", "));

  const priorStatus = await stagingFetch("/api/cron/formula-dc-sms-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageIds: PRIOR_IDS }),
  });

  console.log("\n--- Prior message status probe ---");
  console.log(JSON.stringify(priorStatus, null, 2));

  const send = await stagingFetch("/api/cron/formula-dc-sms-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });

  console.log("\n--- Fresh OTP + transactional sends ---");
  console.log(JSON.stringify(send, null, 2));

  const newIds = [];
  const otpId = send.body?.otp?.sendSmsResult?.id;
  const txnId = send.body?.transactional?.sendSmsResult?.id;
  if (otpId) newIds.push(otpId);
  if (txnId) newIds.push(txnId);

  console.log(`\nWaiting ${WAIT_MS / 1000}s before re-checking status...`);
  await sleep(WAIT_MS);

  const newStatus = newIds.length
    ? await stagingFetch("/api/cron/formula-dc-sms-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageIds: newIds }),
      })
    : { status: 0, body: { error: "No new message ids from send" } };

  console.log("\n--- New message status probe (after wait) ---");
  console.log(JSON.stringify(newStatus, null, 2));

  const report = {
    at: new Date().toISOString(),
    phone,
    prior: {
      httpStatus: priorStatus.status,
      results: (priorStatus.body?.results ?? []).map(summarizeStatusProbe),
    },
    freshSend: {
      httpStatus: send.status,
      otp: send.body?.otp ?? null,
      transactional: send.body?.transactional ?? null,
      hubtelCalls: send.body?.providerCalls?.hubtel ?? null,
      formulaDcCalls: send.body?.providerCalls?.formulaDc ?? null,
    },
    afterWait: {
      httpStatus: newStatus.status,
      results: (newStatus.body?.results ?? []).map(summarizeStatusProbe),
    },
  };

  const outPath = resolve(process.cwd(), "scripts/_formula-dc-delivery-verify-out.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log("\nWrote", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
