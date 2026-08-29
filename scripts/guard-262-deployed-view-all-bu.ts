/**
 * Guard: refuse applying scripts/262_user_accounts_view_all_business_units.sql
 * until the deployed app contains Phase-6-prep view/stamp markers.
 *
 * Technique (same as guard-261):
 *   1) Vercel protection bypass (header)
 *   2) Ephemeral Supabase staff session so dashboard HTML includes route chunks
 *   3) Collect /_next/static/*.js + recursive Turbopack expand
 *   4) Require distinctive markers from utils/business-unit-view.ts
 *
 * Markers (approved):
 *   - view_all_business_units
 *   - dfoms-bu-view-all-no-stamp
 *   - dfoms-bu-view-all-no-lock (if missing → UNVERIFIED + --confirm-lock-view-all-gate)
 *
 * Usage:
 *   npx tsx scripts/guard-262-deployed-view-all-bu.ts --env staging
 *   npx tsx scripts/guard-262-deployed-view-all-bu.ts --env staging --confirm-lock-view-all-gate
 *   npx tsx scripts/guard-262-deployed-view-all-bu.ts --env production --confirm-lock-view-all-gate
 *
 * Before --confirm-lock-view-all-gate, verify on the *deployed commit*:
 *   utils/phase5e-lock.ts blocks Lock when view_all is true (LOCK_REQUIRES_SCOPED_BU_MESSAGE
 *   / dfoms-bu-view-all-no-lock), and allows workspace default (null + view_all false).
 *
 * See also: scripts/README-guard-262.md
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
  "/dashboard",
  "/dashboard/finance/tax-ledger",
  "/dashboard/finance/balance-sheet",
];

const NEXT_STATIC_JS_RE = /\/_next\/static\/[^"' ]+\.js/g;
const SCRIPT_SRC_RE = /<script[^>]+src=["']([^"']+)["']/gi;
const STATIC_CHUNK_TAIL_RE =
  /(?:\/_next\/)?static\/immutable\/chunks\/[a-zA-Z0-9._-]+\.js/g;

const MAX_CHUNKS = 350;

/** Approved distinctive markers (must stay in sync with utils/business-unit-view.ts). */
const MARKER_VIEW_ALL_FIELD = "view_all_business_units";
const MARKER_STAMP_REFUSE = "dfoms-bu-view-all-no-stamp";
const MARKER_LOCK_REFUSE = "dfoms-bu-view-all-no-lock";

const LOCK_UNVERIFIED_MSG =
  "lock view_all gate: UNVERIFIED — dfoms-bu-view-all-no-lock not found in client chunks (expected: lives in server-safe phase5e-lock / business-unit-view). Pass --confirm-lock-view-all-gate only after manually verifying utils/phase5e-lock.ts on the deployed commit blocks Lock when view_all is true. See scripts/README-guard-262.md";

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

export function parseGuard262Args(argv: string[]) {
  const envIdx = argv.indexOf("--env");
  const environment = envIdx >= 0 ? argv[envIdx + 1] : null;
  if (environment !== "staging" && environment !== "production") {
    throw new Error("--env staging|production required");
  }
  return {
    environment: environment as "staging" | "production",
    skipGuard: argv.includes("--skip-guard"),
    confirmLockViewAllGate: argv.includes("--confirm-lock-view-all-gate"),
    baseUrl: environment === "production" ? PRODUCTION_URL : STAGING_URL,
  };
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
      "guard-262: no ephemeral auth (missing staging/prod supabase env) — dashboard routes may redirect to login",
    );
    return { attached: false, cleanup: async () => {} };
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `guard262+${Date.now()}@davors.internal`;
  const password = `G1!${Math.random().toString(36).slice(2)}Aa1`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (createErr || !created.user) {
    console.log("guard-262: ephemeral createUser failed:", createErr?.message);
    return { attached: false, cleanup: async () => {} };
  }

  const userId = created.user.id;
  await admin.from("user_accounts").upsert(
    {
      auth_uid: userId,
      tenant_id: DAVORS_TENANT_ID,
      role: "finance",
      is_active: true,
    },
    { onConflict: "auth_uid" },
  );

  const cookieJar: { name: string; value: string }[] = [];
  const userClient = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieJar,
      setAll: (cookies) => {
        for (const c of cookies) {
          const i = cookieJar.findIndex((x) => x.name === c.name);
          if (i >= 0) cookieJar[i] = { name: c.name, value: c.value };
          else cookieJar.push({ name: c.name, value: c.value });
        }
      },
    },
  });
  const { error: signErr } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signErr || cookieJar.length === 0) {
    console.log("guard-262: ephemeral signIn failed:", signErr?.message);
    await admin.auth.admin.deleteUser(userId);
    return { attached: false, cleanup: async () => {} };
  }

  const existing = headers.Cookie ? `${headers.Cookie}; ` : "";
  headers.Cookie =
    existing + cookieJar.map((c) => `${c.name}=${c.value}`).join("; ");
  console.log(
    `guard-262: ephemeral staff session attached (${cookieJar.length} cookie(s))`,
  );

  return {
    attached: true,
    cleanup: async () => {
      try {
        await admin.auth.admin.deleteUser(userId);
        console.log("guard-262: ephemeral auth user cleaned up");
      } catch (e) {
        console.log(
          "guard-262: ephemeral cleanup warning:",
          e instanceof Error ? e.message : e,
        );
      }
    },
  };
}

export async function guard262DeployedViewAllBu(options: {
  environment: "staging" | "production";
  baseUrl?: string;
  skipGuard?: boolean;
  confirmLockViewAllGate?: boolean;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (options.skipGuard) {
    console.log("guard-262: SKIPPED (--skip-guard)");
    return { ok: true };
  }

  const baseUrl =
    options.baseUrl ??
    (options.environment === "production" ? PRODUCTION_URL : STAGING_URL);
  const expectedHost = new URL(baseUrl).host;
  const bypass = loadBypassFromEnvFiles();
  const headers: Record<string, string> = {
    "user-agent": "dfoms-guard-262",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  if (bypass) {
    headers["x-vercel-protection-bypass"] = bypass;
    console.log("guard-262: using Vercel protection bypass header");
  } else {
    console.log(
      "guard-262: no Vercel bypass secret found — protected previews may SSO-redirect",
    );
  }

  console.log(
    `guard-262: scanning deployed app at ${baseUrl} (${options.environment})`,
  );
  console.log(
    `guard-262: lock view_all confirm flag=${Boolean(options.confirmLockViewAllGate)}`,
  );

  const auth = await attachEphemeralAuthCookie(options.environment, headers);
  try {
    const scriptPaths = new Set<string>();
    const pageDiagnostics: string[] = [];

    for (const path of ENTRY_PATHS) {
      const page = await fetchText(`${baseUrl}${path}`, headers);
      if (page.cookieHeader) headers.Cookie = page.cookieHeader;

      const finalHost = (() => {
        try {
          return new URL(page.finalUrl).host;
        } catch {
          return "";
        }
      })();
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
      `guard-262: ${scriptPaths.size} script refs discovered; downloaded ${downloadedOk} chunks (${jsFail} failed)`,
    );

    if (downloadedOk === 0) {
      return {
        ok: false,
        reason: [
          "  - Empty scan: no app JS chunks downloaded.",
          "    This is inconclusive — not a Phase-6-prep safety PASS.",
          "    Page diagnostics:",
          ...pageDiagnostics.map((d) => `    - ${d}`),
          bypass
            ? "    Bypass was sent; check SSO still intercepting or deploy URL wrong."
            : "    Tip: put Vercel bypass in .env.staging.local or .cursor/browser-login.json.",
        ].join("\n"),
      };
    }

    let combined = "";
    for (const body of downloadedBodies.values()) {
      if (body) combined += body;
    }

    const hasViewAllField = combined.includes(MARKER_VIEW_ALL_FIELD);
    const hasStampRefuse = combined.includes(MARKER_STAMP_REFUSE);
    const hasLockRefuse = combined.includes(MARKER_LOCK_REFUSE);

    console.log(
      `guard-262: markers view_all_field=${hasViewAllField} stamp_refuse=${hasStampRefuse} lock_refuse=${hasLockRefuse}`,
    );

    const failures: string[] = [];

    if (!hasViewAllField) {
      failures.push(
        `missing client marker "${MARKER_VIEW_ALL_FIELD}" — deploy Phase-6-prep app before applying 262`,
      );
    }
    if (!hasStampRefuse) {
      failures.push(
        `missing client marker "${MARKER_STAMP_REFUSE}" — stamp-refuse constant not in deployed chunks`,
      );
    }

    if (hasLockRefuse) {
      console.log(
        "guard-262: lock view_all gate: found dfoms-bu-view-all-no-lock in chunks",
      );
    } else {
      console.log(`guard-262: ${LOCK_UNVERIFIED_MSG}`);
      if (!options.confirmLockViewAllGate) {
        failures.push(LOCK_UNVERIFIED_MSG);
      } else {
        console.log(
          "guard-262: lock view_all gate: accepted via --confirm-lock-view-all-gate (human attested)",
        );
      }
    }

    if (failures.length > 0) {
      return {
        ok: false,
        reason: failures.map((f) => `  - ${f}`).join("\n"),
      };
    }

    console.log(
      "guard-262: PASS — Phase-6-prep view/stamp markers present; lock gate confirmed",
    );
    return { ok: true };
  } finally {
    await auth.cleanup();
  }
}

async function main() {
  const args = parseGuard262Args(process.argv.slice(2));
  const result = await guard262DeployedViewAllBu(args);
  if (!result.ok) {
    console.error(
      "guard-262: REFUSING — unsafe to apply 262:\n" + result.reason,
    );
    process.exit(1);
  }
}

const isDirect =
  process.argv[1]?.includes("guard-262-deployed-view-all-bu") ||
  process.argv[1]
    ?.replace(/\\/g, "/")
    .endsWith("guard-262-deployed-view-all-bu.ts");

if (isDirect) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
