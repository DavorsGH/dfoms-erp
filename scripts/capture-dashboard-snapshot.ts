/**
 * Save dashboard snapshot JSON for diff-dashboard-snapshots.mjs (requires
 * DFOMS_PERF_SNAPSHOT_APIS=true on server; not available on Vercel production).
 *
 * Usage:
 *   npx tsx scripts/capture-dashboard-snapshot.ts --month 2026-08 --out before.json
 *   npx tsx scripts/capture-dashboard-snapshot.ts --app-url https://staging.example.com --month 2026-08 --out after.json
 *
 * Authenticated session: pass --cookie "name=value; ..." from browser DevTools after MFA login.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--month" || arg === "--out" || arg === "--app-url" || arg === "--cookie") {
      const value = argv[i + 1];
      if (value) {
        out[arg.slice(2)] = value;
        i += 1;
      }
    }
  }
  return out;
}

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
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
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const month = args.month?.trim();
  const outPath = args.out?.trim();
  if (!month || !outPath) {
    console.error(
      "Usage: npx tsx scripts/capture-dashboard-snapshot.ts --month YYYY-MM --out path.json [--app-url URL] [--cookie \"...\"]",
    );
    process.exit(1);
  }

  loadEnv(resolve(".env.staging.local"));
  const appUrl = (args["app-url"] ?? process.env.CAPTURE_APP_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  const cookie = args.cookie ?? process.env.CAPTURE_SESSION_COOKIE ?? "";

  const url = new URL("/api/dashboard/snapshot", appUrl);
  url.searchParams.set("month", month);

  const response = await fetch(url, {
    headers: cookie ? { Cookie: cookie } : {},
    cache: "no-store",
  });
  const body = await response.text();
  if (!response.ok) {
    console.error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
    process.exit(1);
  }

  const parsed = JSON.parse(body) as unknown;
  writeFileSync(resolve(outPath), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  console.log(`Wrote ${resolve(outPath)} (${response.status})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
