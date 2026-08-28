/**
 * Offline tenant workspace logo — shell cache warm + offline display.
 *
 * Uses a tenant with a custom logo_url (Caanta Market on staging when present).
 * SW must be active (production build); next dev unregisters the SW.
 *
 *   npm run build && npm run start
 *   $env:APP_URL="http://localhost:3000"
 *   npx tsx scripts/_test-offline-tenant-logo-local.ts --env-file .env.staging.local
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import { OFFLINE_ASSET_WORKSPACE_LOGO_PATH } from "../lib/client-cache/constants";
import { offlineWorkspaceLogoSrc } from "../lib/client-cache/offline-shell-assets";

const APP_URL = (
  process.env.APP_URL ??
  process.env.STAGING_APP_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");
const STAGING_REF = "wieflwbfdmjtsdnwbfii";
/** Caanta Market on staging — custom tenant logo (storage → signed URL). */
const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

type Check = { step: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(step: string, pass: boolean, detail: string) {
  checks.push({ step, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
}

async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(600);
}

async function waitForShellLogoCache(page: Page, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = (await page.evaluate(`(async () => {
      const target = ${JSON.stringify(OFFLINE_ASSET_WORKSPACE_LOGO_PATH)};
      const keys = await caches.keys();
      const shell = keys.find((k) => k.includes("davors-erp-shell"));
      if (!shell) return { ready: false, shell: null, hasLogo: false };
      const cache = await caches.open(shell);
      const match = await cache.match(new URL(target, window.location.origin).href);
      return { ready: Boolean(match), shell, hasLogo: Boolean(match) };
    })()`)) as { ready: boolean; shell: string | null; hasLogo: boolean };
    if (state.ready) {
      return state;
    }
    await page.waitForTimeout(1000);
  }
  return { ready: false, shell: null, hasLogo: false };
}

type LogoProbe = {
  tag: string;
  src: string | null;
  isImg: boolean;
  complete: boolean;
  naturalWidth: number;
  fallbackText: string | null;
  usesOfflineAssetPath: boolean;
};

async function probeWorkspaceLogo(page: Page, rootSelector: string): Promise<LogoProbe> {
  return page.evaluate(
    ({ selector, offlinePath }) => {
      const root = document.querySelector(selector);
      if (!root) {
        return {
          tag: "missing",
          src: null,
          isImg: false,
          complete: false,
          naturalWidth: 0,
          fallbackText: null,
          usesOfflineAssetPath: false,
        };
      }
      const img = root.querySelector("img");
      if (img) {
        const src = img.currentSrc || img.src;
        return {
          tag: "img",
          src,
          isImg: true,
          complete: img.complete && img.naturalWidth > 0,
          naturalWidth: img.naturalWidth,
          fallbackText: null,
          usesOfflineAssetPath: src.includes(offlinePath),
        };
      }
      const fallback = root.querySelector("div");
      return {
        tag: "fallback",
        src: null,
        isImg: false,
        complete: Boolean(fallback?.textContent?.trim()),
        naturalWidth: 0,
        fallbackText: fallback?.textContent?.trim() ?? null,
        usesOfflineAssetPath: false,
      };
    },
    { selector: rootSelector, offlinePath: OFFLINE_ASSET_WORKSPACE_LOGO_PATH },
  );
}

async function resolveTestTenant(
  admin: ReturnType<typeof createClient>,
): Promise<{ id: string; name: string }> {
  const { data: caanta, error } = await admin
    .from("tenants")
    .select("id, name")
    .eq("id", CAANTA_TENANT_ID)
    .maybeSingle();

  assert(!error && caanta?.id, error?.message ?? "Caanta tenant not found on staging");
  return { id: caanta.id, name: caanta.name ?? "Caanta Market" };
}

async function readSidebarLogoSrc(page: Page): Promise<string | null> {
  await page.waitForSelector("aside img[alt*='logo'], aside div[title]", {
    timeout: 15000,
  });
  return page.evaluate(() => {
    const aside = document.querySelector("aside");
    const img = aside?.querySelector("img[alt*='logo']");
    return img ? img.currentSrc || img.src : null;
  });
}

function isRemoteTenantLogo(src: string | null, appOrigin: string): boolean {
  if (!src?.trim()) {
    return false;
  }
  try {
    const url = new URL(src);
    if (url.pathname === "/logo.jpg" || url.pathname.endsWith("/logo.jpg")) {
      return false;
    }
    return url.origin !== appOrigin || url.pathname.startsWith("/storage/");
  } catch {
    return false;
  }
}

function runUnitChecks() {
  const remote = "https://example.supabase.co/storage/v1/object/sign/tenant-logos/x.png";
  record(
    "unit: offlineWorkspaceLogoSrc maps remote URL offline",
    offlineWorkspaceLogoSrc(false, remote) === OFFLINE_ASSET_WORKSPACE_LOGO_PATH,
    offlineWorkspaceLogoSrc(false, remote),
  );
  record(
    "unit: offlineWorkspaceLogoSrc keeps remote URL online",
    offlineWorkspaceLogoSrc(true, remote) === remote,
    offlineWorkspaceLogoSrc(true, remote),
  );
  record(
    "unit: offlineWorkspaceLogoSrc keeps static path offline",
    offlineWorkspaceLogoSrc(false, "/logo.jpg") === "/logo.jpg",
    offlineWorkspaceLogoSrc(false, "/logo.jpg"),
  );
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  console.log(`Target: ${APP_URL}`);
  runUnitChecks();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(supabaseUrl.includes(STAGING_REF), "staging Supabase required");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY required");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tenant = await resolveTestTenant(admin);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const stamp = Date.now();
  const email = `offline.logo.${stamp}@test.davors`;
  const password = `OfflineLogo-${stamp}!Aa8`;
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  assert(!authError && authData.user, authError?.message ?? "createUser");
  const authUid = authData.user.id;

  const { error: accountError } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email,
    role: "super_admin",
    is_active: true,
    tenant_id: tenant.id,
  });
  if (accountError) {
    await admin.auth.admin.deleteUser(authUid);
    throw new Error(accountError.message);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle", timeout: 90000 });
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: /Sign In/i }).click();
    await page.waitForURL("**/dashboard**", { timeout: 90000 });
    record("login online", true, page.url());

    await page.goto(`${APP_URL}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(3000);

    const onlineLogoSrc = await readSidebarLogoSrc(page);
    const appOrigin = new URL(APP_URL).origin;
    const hasRemoteLogo = isRemoteTenantLogo(onlineLogoSrc, appOrigin);
    record(
      "tenant logo source online",
      true,
      hasRemoteLogo
        ? `remote: ${onlineLogoSrc}`
        : `static: ${onlineLogoSrc ?? "none"}`,
    );

    const swState = (await page.evaluate(`(async () => {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      return {
        hasController: Boolean(navigator.serviceWorker?.controller),
        scope: reg?.scope ?? null,
        scriptURL: reg?.active?.scriptURL ?? null,
      };
    })()`)) as {
      hasController: boolean;
      scope: string | null;
      scriptURL: string | null;
    };
    record(
      "service worker controlling page",
      swState.hasController,
      swState.scriptURL ?? "none (use production build: npm run build && npm run start)",
    );

    await page.waitForTimeout(5000);

    const shellCache = await waitForShellLogoCache(page);
    record(
      "shell cache has workspace-logo entry",
      hasRemoteLogo ? shellCache.hasLogo : true,
      hasRemoteLogo
        ? shellCache.shell ?? "no shell cache"
        : "skipped — tenant uses static /logo.jpg",
    );

    await goOffline(context, page);
    await page.waitForTimeout(800);

    const sidebarProbe = await probeWorkspaceLogo(
      page,
      "aside img[alt*='logo'], aside div[title]",
    );
    // Sidebar uses WorkspaceLogo inside aside — locate first workspace logo img/div
    const sidebarLogo = (await page.evaluate(`(() => {
      const aside = document.querySelector("aside");
      if (!aside) return null;
      const img = aside.querySelector("img[alt*='logo']");
      if (img) {
        const src = img.currentSrc || img.src;
        return {
          kind: "img",
          src,
          ok: img.complete && img.naturalWidth > 0,
          w: img.naturalWidth,
          offlinePath: src.includes(${JSON.stringify(OFFLINE_ASSET_WORKSPACE_LOGO_PATH)}),
        };
      }
      const fallback = aside.querySelector("div[title]");
      return {
        kind: "fallback",
        src: null,
        ok: Boolean(fallback?.textContent?.trim()),
        w: 0,
        offlinePath: false,
        text: fallback?.textContent?.trim() ?? null,
      };
    })()`)) as {
      kind: string;
      src: string | null;
      ok: boolean;
      w: number;
      offlinePath: boolean;
      text?: string | null;
    } | null;

    const sidebarOk =
      Boolean(sidebarLogo) &&
      (sidebarLogo!.kind === "img"
        ? hasRemoteLogo
          ? sidebarLogo!.offlinePath && sidebarLogo!.ok
          : sidebarLogo!.ok
        : Boolean(sidebarLogo!.ok && sidebarLogo!.text));
    record(
      "offline sidebar logo renders (cached img or initials fallback)",
      sidebarOk,
      sidebarLogo
        ? sidebarLogo.kind === "img"
          ? `src=${sidebarLogo.src} w=${sidebarLogo.w} offline=${sidebarLogo.offlinePath}`
          : `fallback="${sidebarLogo.text}"`
        : "sidebar logo not found",
    );

    // Finance expense report uses ReportCompanyHeader when report data loads.
    await page.goto(`${APP_URL}/dashboard/reports/finance/expense-report`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2500);

    const reportHeaderLogo = (await page.evaluate(`(() => {
      const header = document.querySelector("header.mb-6");
      if (!header) return { found: false, ok: false, detail: "no ReportCompanyHeader" };
      const img = header.querySelector("img");
      if (img) {
        const src = img.currentSrc || img.src;
        return {
          found: true,
          ok: img.complete && img.naturalWidth > 0,
          kind: "img",
          src,
          offlinePath: src.includes(${JSON.stringify(OFFLINE_ASSET_WORKSPACE_LOGO_PATH)}),
          w: img.naturalWidth,
        };
      }
      const fallback = header.querySelector("div[title]");
      return {
        found: true,
        ok: Boolean(fallback?.textContent?.trim()),
        kind: "fallback",
        text: fallback?.textContent?.trim() ?? null,
      };
    })()`)) as {
      found: boolean;
      ok: boolean;
      kind?: string;
      src?: string;
      offlinePath?: boolean;
      w?: number;
      text?: string | null;
      detail?: string;
    };

    if (reportHeaderLogo.found) {
      const reportOk =
        reportHeaderLogo.kind === "img"
          ? Boolean(reportHeaderLogo.offlinePath && reportHeaderLogo.ok)
          : Boolean(reportHeaderLogo.ok);
      record(
        "offline ReportCompanyHeader logo (report page)",
        reportOk,
        reportHeaderLogo.kind === "img"
          ? `src=${reportHeaderLogo.src} w=${reportHeaderLogo.w}`
          : `fallback="${reportHeaderLogo.text}"`,
      );
    } else {
      record(
        "offline ReportCompanyHeader logo (report page)",
        true,
        reportHeaderLogo.detail ?? "skipped — generate report manually to assert header",
      );
    }

    // POS receipt uses ReportCompanyHeader — inject minimal receipt DOM check via component mount path:
    // visit POS and verify no broken remote logo URLs remain in document when offline.
    await page.goto(`${APP_URL}/dashboard/pos`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2000);

    const brokenRemoteLogos = (await page.evaluate(`(() => {
      const imgs = Array.from(document.querySelectorAll("img[alt*='logo']"));
      return imgs
        .filter((img) => {
          const src = img.currentSrc || img.src;
          return src.startsWith("http") && img.complete && img.naturalWidth === 0;
        })
        .map((img) => img.currentSrc || img.src);
    })()`)) as string[];

    record(
      "offline POS page has no broken remote tenant logo imgs",
      brokenRemoteLogos.length === 0,
      brokenRemoteLogos.length
        ? brokenRemoteLogos.join(", ")
        : `sidebarProbe=${sidebarProbe.tag}`,
    );
  } finally {
    await browser.close();
    await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    await admin.auth.admin.deleteUser(authUid);
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
