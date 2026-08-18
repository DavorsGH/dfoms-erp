/**
 * POST deployed staging /api/debug/formula-dc-sms-test (OTP + transactional live send).
 * Reads CRON_SECRET from .env.staging.local; uses Vercel deployment protection bypass.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const STAGING_APP_URL =
  process.env.STAGING_APP_URL ??
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app";
const BYPASS =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ??
  "IJ7aYbMjtmTzXvZFVY1MdDdZYAlZcIDq";
const PHONE = process.argv.includes("--phone")
  ? process.argv[process.argv.indexOf("--phone") + 1]
  : "0244303171";

function loadCronSecret() {
  const envPath = resolve(process.cwd(), ".env.staging.local");
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.startsWith("CRON_SECRET=")) {
      let v = t.slice("CRON_SECRET=".length).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      return v;
    }
  }
  throw new Error("CRON_SECRET missing in .env.staging.local");
}

async function main() {
  const cronSecret = loadCronSecret();
  const url = `${STAGING_APP_URL}/api/cron/formula-dc-sms-test`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cronSecret}`,
      "x-vercel-protection-bypass": BYPASS,
    },
    body: JSON.stringify({ phone: PHONE }),
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 2000) };
  }

  const out = {
    httpStatus: response.status,
    url,
    phone: PHONE,
    body,
  };

  const outPath = resolve(process.cwd(), "scripts/_formula-dc-live-test-out.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(response.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
