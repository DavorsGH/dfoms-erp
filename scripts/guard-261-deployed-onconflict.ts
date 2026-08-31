/**
 * Guard: refuse Phase 5e schema apply if the currently-deployed app still
 * upserts tax_settings / manual_financial_entries with onConflict targets that
 * omit business_unit_id.
 *
 * Technique (client-scannable tables):
 *   1) Vercel protection bypass (header) when available
 *   2) Ephemeral Supabase staff session (staging/prod env) so dashboard HTML
 *      includes route chunks (login shell alone never has Phase 5e strings)
 *   3) Collect /_next/static/*.js refs from HTML + recursive Turbopack expand
 *   4) Scan for onConflict literals + known Phase 5e target strings
 *
 * month_end_close (Lock / Reopen / Release) lives in server-only API routes and
 * NEVER appears in browser /_next/static chunks. Absence in the scan is neither
 * PASS nor FAIL for that table — see UNVERIFIED + --confirm-month-end-close-server.
 *
 * Usage:
 *   npx tsx scripts/guard-261-deployed-onconflict.ts --env staging
 *   npx tsx scripts/guard-261-deployed-onconflict.ts --env staging --confirm-month-end-close-server
 *   npx tsx scripts/guard-261-deployed-onconflict.ts --env production --confirm-month-end-close-server
 *
 * Auto-apply PASS requires ALL of:
 *   - Client PASS: tax_settings target `tenant_id,business_unit_id` found
 *   - Client PASS: manual_financial_entries target `tenant_id,business_unit_id,period_month` found
 *   - No legacy client onConflict for those tables
 *   - --confirm-month-end-close-server (human attestation for API routes)
 *
 * Before passing --confirm-month-end-close-server, manually verify that the
 * *deployed commit* (same SHA as the Ready deployment) contains:
 *
 *   app/api/hr-payroll/lock-period/route.ts
 *   app/api/hr-payroll/release-period/route.ts
 *   app/api/hr-payroll/reopen-period/route.ts
 *
 * each upserting month_end_close with onConflict resolving to exactly:
 *   tenant_id,business_unit_id,month
 * (typically via MONTH_END_CLOSE_ON_CONFLICT from utils/phase5e-key-structure.ts).
 * Do NOT rubber-stamp: open those three files on the deploy SHA and confirm.
 *
 * See also: scripts/README-guard-261.md
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const STAGING_URL =
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app";
const PRODUCTION_URL = "https://portal.davorsfacilities.com";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

const ENTRY_PATHS = [
  "/login",
  "/dashboard/finance/tax-ledger",
  "/dashboard/finance/manual-financial-entries",
  "/dashboard/hr-payroll/payroll-processing",
];

/**
 * Match Next chunk URLs in HTML/JS.
 * IMPORTANT: use [^"' ] — NOT [^"'\\s>] which excludes the letter "s" and
 * never matches /_next/static/... (root cause of empty scans).
 */
const NEXT_STATIC_JS_RE = /\/_next\/static\/[^"' ]+\.js/g;
const SCRIPT_SRC_RE = /<script[^>]+src=["']([^"']+)["']/gi;
const STATIC_CHUNK_TAIL_RE =
  /(?:\/_next\/)?static\/immutable\/chunks\/[a-zA-Z0-9._-]+\.js/g;

const MAX_CHUNKS = 350;

const TAX_TARGET = "tenant_id,business_unit_id";
const MANUAL_TARGET = "tenant_id,business_unit_id,period_month";
const MONTH_END_TARGET = "tenant_id,business_unit_id,month";

const PHASE5E_TARGETS = [
  MONTH_END_TARGET,
  MANUAL_TARGET,
  "tenant_id,business_unit_id,payroll_month",
  TAX_TARGET,
] as const;

const MONTH_END_UNVERIFIED_MSG =
  "month_end_close: UNVERIFIED — server-only API routes (lock/release/reopen-period); cannot confirm via chunk scan. Pass --confirm-month-end-close-server only after manually verifying onConflict is tenant_id,business_unit_id,month in lock-period, release-period, and reopen-period on the deployed commit. See scripts/README-guard-261.md";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    const key = t.slice(0, i).trim();
    if (!process.env[key]) process.env[key] = v;
  }
}

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
      const m = text.match(/x-vercel-protection-bypass=([A-Za-z0-9_-]+)/);
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

export function parseGuard261Args(argv: string[]) {
  const envIdx = argv.indexOf("--env");
  const environment = envIdx >= 0 ? argv[envIdx + 1] : null;
  if (environment !== "staging" && environment !== "production") {
    throw new Error("--env staging|production required");
  }
  return {
    environment: environment as "staging" | "production",
    skipGuard: argv.includes("--skip-guard"),
    confirmMonthEndCloseServer: argv.includes(
      "--confirm-month-end-close-server",
    ),
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

function normalizeScriptPath(raw: string, pageUrl: string): string | null {
  let trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  if (trimmed.startsWith("static/")) trimmed = `/_next/${trimmed}`;
  try {
    const absolute = new URL(trimmed, pageUrl);
    if (!absolute.pathname.includes("/_next/static/")) return null;
    if (!absolute.pathname.endsWith(".js")) return null;
    const pageHost = new URL(pageUrl).host;
    if (absolute.host && absolute.host !== pageHost) return null;
    return absolute.pathname;
  } catch {
    return null;
  }
}

function collectScriptPaths(text: string, pageUrl: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(NEXT_STATIC_JS_RE)) {
    const path = normalizeScriptPath(m[0], pageUrl);
    if (path) found.add(path);
  }
  for (const m of text.matchAll(SCRIPT_SRC_RE)) {
    const path = normalizeScriptPath(m[1], pageUrl);
    if (path) found.add(path);
  }
  for (const m of text.matchAll(STATIC_CHUNK_TAIL_RE)) {
    const path = normalizeScriptPath(m[0], pageUrl);
    if (path) found.add(path);
  }
  return [...found];
}

function mergeSetCookie(
  responseHeaders: Headers,
  existingCookieHeader: string | undefined,
): string | undefined {
  const fresh =
    typeof responseHeaders.getSetCookie === "function"
      ? responseHeaders.getSetCookie()
      : [];
  if (fresh.length === 0) return existingCookieHeader;
  const map = new Map<string, string>();
  for (const part of (existingCookieHeader ?? "").split(";")) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf("=");
    if (i > 0) map.set(t.slice(0, i), t);
  }
  for (const c of fresh) {
    const first = c.split(";")[0]?.trim();
    if (!first) continue;
    const i = first.indexOf("=");
    if (i > 0) map.set(first.slice(0, i), first);
  }
  return [...map.values()].join("; ");
}

/**
 * Manual redirects — Vercel bypass can self-307 on the same path and
 * `redirect: "follow"` then hits "redirect count exceeded".
 */
async function fetchText(
  url: string,
  headers: Record<string, string>,
): Promise<{
  ok: boolean;
  status: number;
  text: string;
  finalUrl: string;
  cookieHeader?: string;
}> {
  const maxHops = 12;
  let current = url;
  let hdrs = { ...headers };
  let last: Response | null = null;

  for (let hop = 0; hop < maxHops; hop++) {
    try {
      last = await fetch(current, { headers: hdrs, redirect: "manual" });
    } catch (error) {
      const cause =
        error instanceof Error
          ? `${error.message}${error.cause ? ` (${String(error.cause)})` : ""}`
          : String(error);
      throw new Error(`fetch failed for ${current}: ${cause}`);
    }
    const merged = mergeSetCookie(last.headers, hdrs.Cookie);
    if (merged) hdrs = { ...hdrs, Cookie: merged };

    if (last.status >= 300 && last.status < 400) {
      const loc = last.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, current).toString();
      // Same-path 307 (bypass cookie hop): one more fetch then stop looping.
      if (next.split("?")[0] === current.split("?")[0]) {
        current = next;
        last = await fetch(current, { headers: hdrs, redirect: "manual" });
        const merged2 = mergeSetCookie(last.headers, hdrs.Cookie);
        if (merged2) hdrs = { ...hdrs, Cookie: merged2 };
        if (!(last.status >= 300 && last.status < 400)) break;
        const loc2 = last.headers.get("location");
        if (!loc2) break;
        const n2 = new URL(loc2, current).toString();
        if (n2.split("?")[0] === current.split("?")[0]) break;
        current = n2;
        continue;
      }
      current = next;
      continue;
    }
    break;
  }

  if (!last) throw new Error(`fetch failed for ${url}: no response`);
  const text = await last.text();
  return {
    ok: last.ok,
    status: last.status,
    text,
    finalUrl: current,
    cookieHeader: hdrs.Cookie,
  };
}

async function attachEphemeralAuthCookie(
  environment: "staging" | "production",
  headers: Record<string, string>,
): Promise<{ cleanup: () => Promise<void>; attached: boolean }> {
  const envFile =
    environment === "production" ? ".env.local.backup" : ".env.staging.local";
  loadEnvFile(resolve(envFile));
  loadEnvFile(resolve(".env.local"));

  const expectedRef =
    environment === "production" ? PRODUCTION_REF : STAGING_REF;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "";

  if (!url.includes(expectedRef) || !serviceKey || !anon) {
    console.log(
      "guard-261: no ephemeral auth (missing staging/prod supabase env) — dashboard routes may redirect to login",
    );
    return { attached: false, cleanup: async () => {} };
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now().toString(36);
  const email = `guard261.${stamp}@test.davors`;
  const password = `G261-${stamp}!Aa8`;
  let authUid: string | null = null;

  const cleanup = async () => {
    if (!authUid) return;
    try {
      await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    } catch {
      /* ignore */
    }
    try {
      await admin.auth.admin.deleteUser(authUid);
    } catch {
      /* ignore */
    }
    console.log("guard-261: ephemeral auth user cleaned up");
  };

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (createErr || !created.user) {
    console.log(
      `guard-261: ephemeral createUser failed: ${createErr?.message ?? "unknown"}`,
    );
    return { attached: false, cleanup };
  }
  authUid = created.user.id;

  const { error: accountErr } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email,
    role: "finance",
    is_active: true,
    tenant_id: DAVORS_TENANT_ID,
  });
  if (accountErr) {
    console.log(
      `guard-261: user_accounts insert failed: ${accountErr.message}`,
    );
    await cleanup();
    return { attached: false, cleanup: async () => {} };
  }

  const cookieStore: { name: string; value: string }[] = [];
  const sessionClient = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore;
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          const index = cookieStore.findIndex((row) => row.name === cookie.name);
          if (index >= 0) {
            cookieStore[index] = { name: cookie.name, value: cookie.value };
          } else {
            cookieStore.push({ name: cookie.name, value: cookie.value });
          }
        }
      },
    },
  });

  const { error: signErr } = await sessionClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signErr || cookieStore.length === 0) {
    console.log(
      `guard-261: ephemeral signIn failed: ${signErr?.message ?? "no cookies"}`,
    );
    await cleanup();
    return { attached: false, cleanup: async () => {} };
  }

  const authCookie = cookieStore.map((c) => `${c.name}=${c.value}`).join("; ");
  const map = new Map<string, string>();
  for (const part of (headers.Cookie ?? "").split(";")) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf("=");
    if (i > 0) map.set(t.slice(0, i), t);
  }
  for (const part of authCookie.split(";")) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf("=");
    if (i > 0) map.set(t.slice(0, i), t);
  }
  headers.Cookie = [...map.values()].join("; ");
  console.log(
    `guard-261: ephemeral staff session attached (${cookieStore.length} cookie(s))`,
  );
  return { attached: true, cleanup };
}

export async function guard261DeployedOnConflict(options: {
  environment: "staging" | "production";
  baseUrl?: string;
  skipGuard?: boolean;
  confirmMonthEndCloseServer?: boolean;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (options.skipGuard) {
    console.log("guard-261: SKIPPED (--skip-guard)");
    return { ok: true };
  }

  const baseUrl =
    options.baseUrl ??
    (options.environment === "production" ? PRODUCTION_URL : STAGING_URL);
  const expectedHost = new URL(baseUrl).host;
  const bypass = loadBypassFromEnvFiles();
  const headers: Record<string, string> = {
    "user-agent": "dfoms-guard-261",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  if (bypass) {
    headers["x-vercel-protection-bypass"] = bypass;
    console.log("guard-261: using Vercel protection bypass header");
  } else {
    console.log(
      "guard-261: no Vercel bypass secret found — protected previews may SSO-redirect",
    );
  }

  console.log(
    `guard-261: scanning deployed app at ${baseUrl} (${options.environment})`,
  );
  console.log(
    `guard-261: month_end_close confirm flag=${Boolean(options.confirmMonthEndCloseServer)}`,
  );

  const auth = await attachEphemeralAuthCookie(options.environment, headers);

  try {
    const scriptPaths = new Set<string>();
    const pageDiagnostics: string[] = [];

    for (const path of ENTRY_PATHS) {
      const page = await fetchText(`${baseUrl}${path}`, headers);
      if (page.cookieHeader) headers.Cookie = page.cookieHeader;

      const finalHost = new URL(page.finalUrl).host;
      const refs =
        finalHost === expectedHost
          ? collectScriptPaths(page.text, page.finalUrl)
          : [];
      for (const ref of refs) scriptPaths.add(ref);

      const looksLikeSso =
        /vercel\.com\/(login|sso-api)/i.test(page.finalUrl) ||
        /Authentication Required|Vercel Authentication/i.test(page.text);

      pageDiagnostics.push(
        `${path} => status=${page.status} final=${page.finalUrl} htmlBytes=${page.text.length} scriptRefs=${refs.length}${looksLikeSso ? " SSO?" : ""}`,
      );
      console.log(`  page ${pageDiagnostics[pageDiagnostics.length - 1]}`);
      if (refs.length > 0) {
        console.log(`    sample: ${refs.slice(0, 3).join(", ")}`);
      }
    }

    const queue = [...scriptPaths];
    const downloadedBodies = new Map<string, string>();
    let jsFail = 0;

    while (queue.length > 0 && downloadedBodies.size < MAX_CHUNKS) {
      const path = queue.shift()!;
      if (downloadedBodies.has(path)) continue;

      const jsRes = await fetchText(`${baseUrl}${path}`, headers);
      if (jsRes.cookieHeader) headers.Cookie = jsRes.cookieHeader;
      if (!jsRes.ok) {
        jsFail += 1;
        downloadedBodies.set(path, "");
        continue;
      }
      downloadedBodies.set(path, jsRes.text);

      for (const ref of collectScriptPaths(jsRes.text, jsRes.finalUrl)) {
        if (!downloadedBodies.has(ref)) {
          scriptPaths.add(ref);
          queue.push(ref);
        }
      }
    }

    const downloadedOk = [...downloadedBodies.values()].filter(
      (b) => b.length > 0,
    ).length;
    console.log(
      `guard-261: ${scriptPaths.size} script refs discovered; downloaded ${downloadedOk} chunks (${jsFail} failed)`,
    );

    if (downloadedOk === 0) {
      return {
        ok: false,
        reason: [
          "  - Empty scan: no app JS chunks downloaded.",
          "    This is inconclusive — not a Phase 5e safety PASS.",
          "    Page diagnostics:",
          ...pageDiagnostics.map((d) => `    - ${d}`),
          bypass
            ? "    Bypass was sent; check SSO still intercepting or deploy URL wrong."
            : "    Tip: put Vercel bypass in .env.staging.local or .cursor/browser-login.json.",
        ].join("\n"),
      };
    }

    const allTargets: Array<{ target: string; path: string }> = [];
    const stringHits = new Set<string>();

    for (const [path, body] of downloadedBodies) {
      if (!body) continue;
      for (const target of extractOnConflictTargets(body)) {
        allTargets.push({ target, path });
      }
      for (const needle of PHASE5E_TARGETS) {
        if (body.includes(needle)) stringHits.add(needle);
      }
    }

    const uniqueTargets = [...new Set(allTargets.map((t) => t.target))];
    console.log(
      `guard-261: ${uniqueTargets.length} distinct onConflict literals`,
    );
    if (uniqueTargets.length > 0) {
      console.log(`  all literals: ${uniqueTargets.join(" | ")}`);
    }
    console.log(
      `guard-261: Phase 5e string hits: ${[...stringHits].join(" | ") || "(none)"}`,
    );

    const failures: string[] = [];

    // Legacy client patterns that prove a bad deploy for tax / manual.
    for (const hit of allTargets) {
      if (/^tenant_id,period_month$/i.test(hit.target)) {
        failures.push(
          `manual_financial_entries legacy onConflict "${hit.target}" in ${hit.path}`,
        );
      }
      if (/^tenant_id,month$/i.test(hit.target)) {
        // Rare in client chunks; if present it is evidence of legacy month_end wiring.
        failures.push(
          `month_end_close-like legacy onConflict "${hit.target}" found in client chunk ${hit.path} (unexpected; investigate)`,
        );
      }
    }

    for (const hit of allTargets) {
      if (
        /tax_settings/.test(downloadedBodies.get(hit.path) ?? "") &&
        /^tenant_id$/i.test(hit.target) &&
        /onConflict\s*:\s*["']tenant_id["']/.test(
          downloadedBodies.get(hit.path) ?? "",
        ) &&
        !/onConflict\s*:\s*["']tenant_id,business_unit_id["']/.test(
          downloadedBodies.get(hit.path) ?? "",
        )
      ) {
        failures.push(
          `tax_settings-like tenant_id-only onConflict in ${hit.path}`,
        );
      }
    }

    const hasTaxBu =
      allTargets.some((t) => /^tenant_id,business_unit_id$/i.test(t.target)) ||
      stringHits.has(TAX_TARGET);
    const hasManualBu =
      allTargets.some((t) =>
        /^tenant_id,business_unit_id,period_month$/i.test(t.target),
      ) || stringHits.has(MANUAL_TARGET);
    const hasMonthEndBu =
      allTargets.some((t) =>
        /^tenant_id,business_unit_id,month$/i.test(t.target),
      ) || stringHits.has(MONTH_END_TARGET);

    console.log(
      `guard-261: client positive signals tax_bu=${hasTaxBu} manual_bu=${hasManualBu}`,
    );
    console.log(
      `guard-261: month_end_close chunk signal=${hasMonthEndBu} (informational only; server routes are authoritative)`,
    );

    if (!hasTaxBu) {
      failures.push(
        `tax_settings: missing client positive signal for "${TAX_TARGET}" — deploy matching app before applying 261`,
      );
    }
    if (!hasManualBu) {
      failures.push(
        `manual_financial_entries: missing client positive signal for "${MANUAL_TARGET}" — deploy matching app before applying 261`,
      );
    }

    // month_end_close: absence is NEVER pass or fail via chunk scan.
    if (hasMonthEndBu) {
      console.log(
        "guard-261: month_end_close: unexpected chunk hit for Phase 5e target (still require human confirm for API routes)",
      );
    } else {
      console.log(`guard-261: ${MONTH_END_UNVERIFIED_MSG}`);
    }

    if (!options.confirmMonthEndCloseServer) {
      failures.push(MONTH_END_UNVERIFIED_MSG);
    } else {
      console.log(
        "guard-261: month_end_close: accepted via --confirm-month-end-close-server (human attested API routes)",
      );
    }

    if (failures.length > 0) {
      return {
        ok: false,
        reason: failures.map((f) => `  - ${f}`).join("\n"),
      };
    }

    console.log(
      "guard-261: PASS — client tax+manual Phase 5e targets found; month_end_close human-confirmed",
    );
    return { ok: true };
  } finally {
    await auth.cleanup();
  }
}

async function main() {
  const args = parseGuard261Args(process.argv.slice(2));
  const result = await guard261DeployedOnConflict(args);
  if (!result.ok) {
    console.error(
      "guard-261: REFUSING — unsafe to apply 261:\n" + result.reason,
    );
    process.exit(1);
  }
}

const isDirect =
  process.argv[1]?.includes("guard-261-deployed-onconflict") ||
  process.argv[1]
    ?.replace(/\\/g, "/")
    .endsWith("guard-261-deployed-onconflict.ts");

if (isDirect) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
