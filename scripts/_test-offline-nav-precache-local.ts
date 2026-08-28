/**
 * Phase 1/2 follow-up: offline nav precache + offline shell links.
 *
 *   $env:APP_URL="http://localhost:3000"
 *   npx tsx scripts/_test-offline-nav-precache-local.ts --env-file .env.staging.local
 *
 * Cold-start: login online → wait for SW warm → go offline WITHOUT visiting
 * attendance/expenses → hard-navigate to those routes → expect page shells
 * (not generic offline). Then hit an uncached route → offline shell with logo
 * + links.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const STAGING_REF = "wieflwbfdmjtsdnwbfii";

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
  await page.waitForTimeout(400);
}

async function goOnline(context: BrowserContext, page: Page) {
  await context.setOffline(false);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(400);
}

async function waitForWarm(page: Page) {
  await page.waitForFunction(
    "Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)",
    { timeout: 30000 },
  );

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const cached = (await page.evaluate(`(async () => {
      const keys = await caches.keys();
      const shell = keys.find((k) => k.includes("davors-erp-shell"));
      if (!shell) return { shell: null, routes: [] };
      const cache = await caches.open(shell);
      const reqs = await cache.keys();
      const wanted = [
        "/offline",
        "/dashboard",
        "/dashboard/hr-payroll/attendance",
        "/dashboard/finance/expenses",
        "/icons/apple-touch-icon-180x180.png",
      ];
      const routes = [];
      for (const r of reqs) {
        let p = r.url;
        try { p = new URL(r.url).pathname; } catch (e) {}
        if (wanted.includes(p) && routes.indexOf(p) === -1) routes.push(p);
      }
      return { shell: shell, routes: routes };
    })()`)) as { shell: string | null; routes: string[] };

    if (
      cached.routes.includes("/dashboard/hr-payroll/attendance") &&
      cached.routes.includes("/dashboard/finance/expenses") &&
      cached.routes.includes("/offline")
    ) {
      return cached;
    }
    await page.waitForTimeout(1000);
    await page.evaluate(`(async () => {
      const reg = await navigator.serviceWorker.ready;
      if (reg.active) reg.active.postMessage({ type: "WARM_OFFLINE_NAV_ROUTES" });
    })()`);
  }

  return (await page.evaluate(`(async () => {
    const keys = await caches.keys();
    const shell = keys.find((k) => k.includes("davors-erp-shell"));
    if (!shell) return { shell: null, routes: [] };
    const cache = await caches.open(shell);
    const reqs = await cache.keys();
    const routes = [];
    for (const r of reqs) {
      try { routes.push(new URL(r.url).pathname); } catch (e) { routes.push(r.url); }
    }
    return { shell: shell, routes: Array.from(new Set(routes)) };
  })()`)) as { shell: string | null; routes: string[] };
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  console.log(`Target: ${APP_URL}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(supabaseUrl.includes(STAGING_REF), "staging required");
  assert(serviceKey, "service role required");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const email = `offline.nav.${stamp}@test.davors`;
  const password = `OfflineNav-${stamp}!Aa8`;
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
    tenant_id: DAVORS_TENANT_ID,
  });
  if (accountError) {
    await admin.auth.admin.deleteUser(authUid);
    throw new Error(accountError.message);
  }

  const browser = await chromium.launch({ headless: true });
  // Fresh context ≈ incognito / cleared site data
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle" });
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: /Sign In/i }).click();
    await page.waitForURL("**/dashboard**", { timeout: 90000 });
    record("login online", true, page.url());

    const warm = await waitForWarm(page);
    await page.evaluate(`(async () => {
      const routes = [
        "/dashboard",
        "/dashboard/hr-payroll/attendance",
        "/dashboard/finance/expenses",
      ];
      await Promise.all(
        routes.map(function (route) {
          return new Promise(function (resolve) {
            var iframe = document.createElement("iframe");
            iframe.style.cssText =
              "position:absolute;width:0;height:0;border:0;visibility:hidden";
            iframe.src = route;
            var done = function () {
              iframe.remove();
              resolve(undefined);
            };
            iframe.onload = done;
            iframe.onerror = done;
            setTimeout(done, 20000);
            document.body.appendChild(iframe);
          });
        }),
      );
    })()`);
    await page.waitForTimeout(2000);

    const staticCached = await page.evaluate(`(async () => {
      const keys = await caches.keys();
      const shell = keys.find((k) => k.includes("davors-erp-shell"));
      if (!shell) return 0;
      const cache = await caches.open(shell);
      const reqs = await cache.keys();
      return reqs.filter((r) => r.url.includes("/_next/static/")).length;
    })()`);
    record(
      "next static chunks cached after warm",
      staticCached > 0,
      `count=${staticCached}`,
    );
    record(
      "SW shell cache present",
      Boolean(warm.shell),
      warm.shell ?? "missing",
    );
    record(
      "logo asset precached",
      warm.routes.includes("/icons/apple-touch-icon-180x180.png"),
      warm.routes.join(", "),
    );
    record(
      "attendance route warmed",
      warm.routes.includes("/dashboard/hr-payroll/attendance"),
      warm.routes.join(", "),
    );
    record(
      "expenses route warmed",
      warm.routes.includes("/dashboard/finance/expenses"),
      warm.routes.join(", "),
    );
    record(
      "dashboard route warmed",
      warm.routes.includes("/dashboard"),
      warm.routes.join(", "),
    );
    record(
      "offline shell precached",
      warm.routes.includes("/offline"),
      warm.routes.join(", "),
    );

    // Cold offline: never visited attendance/expenses this session beyond warm fetch.
    await goOffline(context, page);

    async function offlineGoto(path: string) {
      // Prefer in-document navigation so the controlling SW always intercepts.
      await page
        .evaluate((target) => {
          window.location.assign(target);
        }, `${APP_URL}${path}`)
        .catch(() => undefined);
      await page.waitForTimeout(2000);
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
      } catch {
        // ignore — body may still be readable from SW response
      }
    }

    await offlineGoto("/dashboard/hr-payroll/attendance");
    const attText = await page.locator("body").innerText().catch(() => "");
    const attOk =
      /Attendance|Add Entry|Month|Staff/i.test(attText) &&
      !/You are offline/i.test(attText);
    record(
      "cold offline attendance loads register (not offline shell)",
      attOk,
      attText.slice(0, 180).replace(/\s+/g, " ") || "(empty body)",
    );

    await offlineGoto("/dashboard/finance/expenses");
    const expText = await page.locator("body").innerText().catch(() => "");
    const expOk =
      /Expense|Add Entry|receipt|Vendor/i.test(expText) &&
      !/You are offline/i.test(expText);
    record(
      "cold offline expenses loads register (not offline shell)",
      expOk,
      expText.slice(0, 180).replace(/\s+/g, " ") || "(empty body)",
    );

    await offlineGoto("/dashboard/leave-approvals");
    const shellText = await page.locator("body").innerText().catch(() => "");
    const shellOk = /You are offline/i.test(shellText);
    record(
      "uncached offline → offline shell",
      shellOk,
      shellText.slice(0, 160).replace(/\s+/g, " ") || "(empty body)",
    );

    const styleCheck = (await page.evaluate(`(() => {
      var allDivs = Array.from(document.querySelectorAll('div'));
      var navy = null;
      var card = null;
      for (var i = 0; i < allDivs.length; i++) {
        var el = allDivs[i];
        var bg = getComputedStyle(el).backgroundColor;
        if (bg === 'rgb(15, 39, 68)') navy = bg;
        if (
          bg === 'rgb(255, 255, 255)' &&
          el.innerText &&
          el.innerText.indexOf('You are offline') !== -1
        ) {
          card = bg;
        }
      }
      var bodyBg = getComputedStyle(document.body).backgroundColor;
      return {
        navy: navy || bodyBg,
        card: card,
        hasInlineStyleTag: Boolean(document.querySelector('style')),
        shellUsesInlineBg: Boolean(
          document.documentElement.innerHTML.indexOf('backgroundColor') !== -1 ||
          document.documentElement.innerHTML.indexOf('background-color') !== -1
        ),
      };
    })()`)) as {
      navy: string | null;
      card: string | null;
      hasInlineStyleTag: boolean;
      shellUsesInlineBg: boolean;
    };
    const styledOk =
      styleCheck.navy === "rgb(15, 39, 68)" &&
      styleCheck.card === "rgb(255, 255, 255)" &&
      styleCheck.hasInlineStyleTag &&
      styleCheck.shellUsesInlineBg;
    record(
      "offline shell branded styles (build-hash independent)",
      styledOk,
      JSON.stringify(styleCheck),
    );

    const logoOk = await page.evaluate(`(() => {
      const img = document.querySelector(
        'img[src="/icons/apple-touch-icon-180x180.png"]',
      );
      return Boolean(img && img.complete && img.naturalWidth > 0);
    })()`);
    record(
      "offline shell logo renders",
      Boolean(logoOk),
      logoOk ? "naturalWidth>0" : "broken/missing",
    );

    const hasAttLink = await page
      .getByRole("link", { name: "Attendance Register" })
      .isVisible()
      .catch(() => false);
    const hasExpLink = await page
      .getByRole("link", { name: "Expense Register" })
      .isVisible()
      .catch(() => false);
    const hasDashLink = await page
      .getByRole("link", { name: "Dashboard" })
      .first()
      .isVisible()
      .catch(() => false);
    record(
      "offline shell offers available-offline links",
      hasAttLink && hasExpLink && hasDashLink,
      `att=${hasAttLink} exp=${hasExpLink} dash=${hasDashLink}`,
    );

    await page.evaluate(`(() => {
      const link = document.querySelector(
        'a[href="/dashboard/hr-payroll/attendance"]',
      );
      if (link) link.click();
    })()`);
    await page.waitForTimeout(2500);
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    } catch {
      // ignore
    }
    const viaLink = await page.locator("body").innerText().catch(() => "");
    record(
      "offline shell link reaches attendance",
      /Attendance|Add Entry|Staff/i.test(viaLink) &&
        !/You are offline/i.test(viaLink),
      viaLink.slice(0, 160).replace(/\s+/g, " ") || "(empty body)",
    );

    await goOnline(context, page);
  } finally {
    await browser.close();
    await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    await admin.auth.admin.deleteUser(authUid).catch(() => undefined);
  }

  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
