/**
 * Guard: refuse Phase 5e schema apply if the currently-deployed app still
 * upserts tax_settings / month_end_close / manual_financial_entries /
 * payroll_link with onConflict targets that omit business_unit_id.
 *
 * Same technique as scripts/_urgent-scan-deployed-onconflict.ts:
 * fetch HTML → download /_next/static chunks → scan onConflict literals.
 *
 * Usage:
 *   npx tsx scripts/guard-261-deployed-onconflict.ts --env staging
 *   npx tsx scripts/guard-261-deployed-onconflict.ts --env production
 *   npx tsx scripts/guard-261-deployed-onconflict.ts --env staging --skip-guard  # no-op pass (dev only)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const STAGING_URL =
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app";
const PRODUCTION_URL = "https://portal.davorsfacilities.com";

const ENTRY_PATHS = [
  "/dashboard/hr-payroll/payroll-processing",
  "/dashboard/finance/tax-ledger",
  "/dashboard/finance/manual-financial-entries",
  "/login",
];

/** Legacy onConflict targets that must NOT appear once Phase 5e app is live. */
const LEGACY_TARGETS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "tax_settings-like tenant_id-only",
    // Exact tenant_id alone (not tenant_id,business_unit_id)
    pattern: /^tenant_id$/i,
  },
  {
    name: "month_end_close tenant_id,month",
    pattern: /^tenant_id\s*,\s*month$/i,
  },
  {
    name: "payroll_link tenant_id,payroll_month",
    pattern: /^tenant_id\s*,\s*payroll_month$/i,
  },
  {
    name: "manual_financial_entries tenant_id,period_month",
    pattern: /^tenant_id\s*,\s*period_month$/i,
  },
];

const REQUIRED_IF_PRESENT: Array<{ name: string; detect: RegExp; require: RegExp }> =
  [
    {
      name: "month_end_close",
      detect: /tenant_id\s*,\s*(?:business_unit_id\s*,\s*)?month/i,
      require: /business_unit_id/i,
    },
    {
      name: "manual_financial_entries",
      detect: /tenant_id\s*,\s*(?:business_unit_id\s*,\s*)?period_month/i,
      require: /business_unit_id/i,
    },
    {
      name: "payroll_link",
      detect: /tenant_id\s*,\s*(?:business_unit_id\s*,\s*)?payroll_month/i,
      require: /business_unit_id/i,
    },
  ];

function loadBypassFromEnvFiles(): string | null {
  for (const file of [
    ".env.staging.local",
    ".env.local",
    ".cursor/browser-login.json",
  ]) {
    const path = resolve(file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    if (file.endsWith(".json")) {
      const m = text.match(/x-vercel-protection-bypass=([A-Za-z0-9]+)/);
      if (m) return m[1];
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (
        t.startsWith("VERCEL_AUTOMATION_BYPASS_SECRET=") ||
        t.startsWith("VERCEL_PROTECTION_BYPASS=")
      ) {
        let v = t.slice(t.indexOf("=") + 1).trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (v) return v;
      }
    }
  }
  return process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || null;
}

function parseArgs(argv: string[]) {
  const envIdx = argv.indexOf("--env");
  const environment = envIdx >= 0 ? argv[envIdx + 1] : null;
  if (environment !== "staging" && environment !== "production") {
    throw new Error("--env staging|production required");
  }
  return {
    environment,
    skipGuard: argv.includes("--skip-guard"),
    baseUrl: environment === "production" ? PRODUCTION_URL : STAGING_URL,
  };
}

function extractOnConflictTargets(js: string): string[] {
  const found = new Set<string>();
  for (const re of [
    /onConflict\s*:\s*["']([^"']+)["']/g,
    /onConflict\s*:\s*`([^`]+)`/g,
    /on_conflict["']?\s*:\s*["']([^"']+)["']/gi,
  ]) {
    for (const m of js.matchAll(re)) {
      found.add(m[1].replace(/\s+/g, ""));
    }
  }
  return [...found];
}

async function fetchText(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; text: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers,
    redirect: "follow",
  });
  return {
    ok: res.ok,
    status: res.status,
    text: await res.text(),
    finalUrl: res.url,
  };
}

export async function guard261DeployedOnConflict(options: {
  environment: "staging" | "production";
  baseUrl?: string;
  skipGuard?: boolean;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (options.skipGuard) {
    console.log("guard-261: SKIPPED (--skip-guard)");
    return { ok: true };
  }

  const baseUrl =
    options.baseUrl ??
    (options.environment === "production" ? PRODUCTION_URL : STAGING_URL);
  const bypass = loadBypassFromEnvFiles();
  const headers: Record<string, string> = {
    "user-agent": "dfoms-guard-261",
  };
  if (bypass) {
    headers["x-vercel-protection-bypass"] = bypass;
  }

  console.log(`guard-261: scanning deployed app at ${baseUrl} (${options.environment})`);

  const scriptPaths = new Set<string>();
  let origin = baseUrl;
  for (const path of ENTRY_PATHS) {
    const page = await fetchText(`${baseUrl}${path}`, headers);
    if (!page.ok && page.status !== 307 && page.status !== 302) {
      console.log(`  page ${path} => ${page.status} (continuing)`);
    }
    origin = new URL(page.finalUrl).origin;
    for (const m of page.text.matchAll(/\/_next\/static\/[^"'\\s>]+\.js/g)) {
      scriptPaths.add(m[0]);
    }
  }

  const unique = [...scriptPaths].slice(0, 120);
  console.log(`guard-261: ${unique.length} script refs to scan`);

  const allTargets: Array<{ target: string; path: string }> = [];
  for (const path of unique) {
    const jsRes = await fetchText(`${origin}${path}`, headers);
    if (!jsRes.ok) continue;
    for (const target of extractOnConflictTargets(jsRes.text)) {
      allTargets.push({ target, path });
    }
  }

  const uniqueTargets = [...new Set(allTargets.map((t) => t.target))];
  console.log(`guard-261: ${uniqueTargets.length} distinct onConflict literals`);

  const failures: string[] = [];

  for (const { name, pattern } of LEGACY_TARGETS) {
    const hits = allTargets.filter((t) => pattern.test(t.target));
    if (hits.length === 0) continue;

    // tenant_id alone is used by many unrelated tables (billing_settings, etc.).
    // Only fail tenant_id-only if we also see Phase 5e table markers nearby in same chunk
    // OR if it's clearly month/period targets (those are specific).
    if (name.startsWith("tax_settings") && pattern.source === "^tenant_id$") {
      // Soft: require evidence of tax_settings upsert context in chunk
      let confirmed = false;
      for (const hit of hits) {
        const jsRes = await fetchText(`${origin}${hit.path}`, headers);
        if (
          jsRes.ok &&
          /tax_settings/.test(jsRes.text) &&
          /onConflict\s*:\s*["']tenant_id["']/.test(jsRes.text)
        ) {
          // If the same chunk also has tenant_id,business_unit_id for tax, allow
          const hasBu = /onConflict\s*:\s*["']tenant_id,business_unit_id["']/.test(
            jsRes.text,
          );
          if (!hasBu) {
            confirmed = true;
            failures.push(
              `${name}: found onConflict "${hit.target}" in ${hit.path} with tax_settings and no tenant_id,business_unit_id`,
            );
          }
        }
      }
      if (!confirmed) {
        console.log(`  note: bare tenant_id onConflict present but not confirmed against tax_settings — OK`);
      }
      continue;
    }

    for (const hit of hits) {
      failures.push(`${name}: found onConflict "${hit.target}" in ${hit.path}`);
    }
  }

  for (const { name, detect, require } of REQUIRED_IF_PRESENT) {
    const hits = allTargets.filter((t) => detect.test(t.target));
    for (const hit of hits) {
      if (!require.test(hit.target)) {
        failures.push(
          `${name}: onConflict "${hit.target}" is missing business_unit_id (${hit.path})`,
        );
      }
    }
  }

  // Positive signal: expect month_end_close BU target once app is deployed
  const hasMonthEndBu = allTargets.some((t) =>
    /^tenant_id,business_unit_id,month$/i.test(t.target),
  );
  const hasManualBu = allTargets.some((t) =>
    /^tenant_id,business_unit_id,period_month$/i.test(t.target),
  );
  const hasTaxBu = allTargets.some((t) =>
    /^tenant_id,business_unit_id$/i.test(t.target),
  );

  console.log(
    `guard-261: positive signals month_end_bu=${hasMonthEndBu} manual_bu=${hasManualBu} tax_bu=${hasTaxBu}`,
  );

  if (!hasMonthEndBu && !hasManualBu && !hasTaxBu) {
    failures.push(
      "No Phase 5e onConflict targets (with business_unit_id) found in deployed bundle — deploy matching app before applying 261",
    );
  }

  if (failures.length > 0) {
    return {
      ok: false,
      reason: failures.map((f) => `  - ${f}`).join("\n"),
    };
  }

  console.log("guard-261: PASS — deployed onConflict targets include business_unit_id");
  return { ok: true };
}

async function main() {
  const { environment, skipGuard, baseUrl } = parseArgs(process.argv.slice(2));
  const result = await guard261DeployedOnConflict({
    environment,
    baseUrl,
    skipGuard,
  });
  if (!result.ok) {
    console.error("guard-261: REFUSING — unsafe to apply 261:\n" + result.reason);
    process.exit(1);
  }
}

const isDirect =
  process.argv[1]?.includes("guard-261-deployed-onconflict") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("guard-261-deployed-onconflict.ts");

if (isDirect) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
