/**
 * Verify offline route warm runs once per login session, not on every navigation.
 *
 * Requires production build + SW (dev unregisters SW):
 *   npm run build && npm run start -p 3002
 *   $env:APP_URL="http://localhost:3002"
 *   npx tsx scripts/_test-offline-warm-once-local.ts --env-file .env.staging.local
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import {
  OFFLINE_ROUTE_WARM_STORAGE_PREFIX,
  OFFLINE_NAV_ROUTES,
} from "../lib/offline-nav-warm";

const APP_URL = (
  process.env.APP_URL ??
  process.env.STAGING_APP_URL ??
  "http://localhost:3002"
).replace(/\/$/, "");
const STAGING_REF = "wieflwbfdmjtsdnwbfii";

type Check = { step: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(step: string, pass: boolean, detail: string) {
  checks.push({ step, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
}

function isWarmRoutePath(pathname: string): boolean {
  return OFFLINE_NAV_ROUTES.some(
    (route) => pathname === route || pathname === `${route}/`,
  );
}

function attachWarmBurstTracker(page: Page) {
  const warmRoutesSeen = new Set<string>();

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      return;
    }
    const frameUrl = frame.url();
    if (!frameUrl || frameUrl === "about:blank") {
      return;
    }
    try {
      const pathname = new URL(frameUrl).pathname;
      if (isWarmRoutePath(pathname)) {
        warmRoutesSeen.add(pathname.replace(/\/$/, "") || pathname);
      }
    } catch {
      // ignore
    }
  });

  return {
    read: () => ({
      warmRoutesSeen: [...warmRoutesSeen],
      warmRouteCount: warmRoutesSeen.size,
    }),
  };
}

async function readWarmState(page: Page) {
  return page.evaluate((prefix) => {
    const keys = Object.keys(sessionStorage).filter((k) =>
      k.startsWith(`${prefix}:`),
    );
    const warmFlag = keys.length > 0 ? sessionStorage.getItem(keys[0]!) : null;
    return { warmFlag, warmKeys: keys };
  }, OFFLINE_ROUTE_WARM_STORAGE_PREFIX);
}

async function waitForWarmFlag(page: Page, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readWarmState(page);
    if (state.warmFlag === "1") {
      return state;
    }
    await page.waitForTimeout(500);
  }
  return readWarmState(page);
}

async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
  });
  await page.waitForTimeout(400);
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  console.log(`Target: ${APP_URL}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(supabaseUrl.includes(STAGING_REF), "staging Supabase required");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY required");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const email = `offline.warmonce.${stamp}@test.davors`;
  const password = `WarmOnce-${stamp}!Aa8`;
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
    tenant_id: "00000001-0000-4000-8000-000000000001",
  });
  assert(!accountError, accountError?.message ?? "user_accounts insert");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const warmTracker = attachWarmBurstTracker(page);

  try {
    await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 90000 });

    const afterLogin = await waitForWarmFlag(page);
    await page.waitForTimeout(2000);
    const burstAfterLogin = warmTracker.read();

    record(
      "session warm flag set after login",
      afterLogin.warmFlag === "1",
      `flag=${afterLogin.warmFlag} keys=${afterLogin.warmKeys.join(",")}`,
    );
    record(
      "exactly one warm burst on login (4 warm routes via iframes)",
      burstAfterLogin.warmRouteCount === 4,
      `routes=${burstAfterLogin.warmRoutesSeen.join(",")}`,
    );

    const baselineWarmRoutes = burstAfterLogin.warmRouteCount;

    await page.goto(`${APP_URL}/dashboard/employees`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(1500);
    await page.goto(`${APP_URL}/dashboard/pos`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(1500);
    await page.goto(`${APP_URL}/dashboard/finance/expenses`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(1500);
    await page.goto(`${APP_URL}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(1500);

    const burstAfterNav = warmTracker.read();
    const afterNav = await readWarmState(page);
    record(
      "no extra warm iframes after multi-page navigation",
      burstAfterNav.warmRouteCount === baselineWarmRoutes,
      `before=${baselineWarmRoutes} after=${burstAfterNav.warmRouteCount}`,
    );
    record(
      "session warm flag still set after navigation",
      afterNav.warmFlag === "1",
      `flag=${afterNav.warmFlag}`,
    );

    await goOffline(context, page);

    await page.goto(`${APP_URL}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2000);
    const dashboardOffline = await page.evaluate(() =>
      /Dashboard|Welcome|ERP/i.test(document.body?.innerText ?? ""),
    );
    record(
      "Dashboard loads offline after single login warm",
      dashboardOffline,
      `found=${dashboardOffline}`,
    );

    await page.goto(`${APP_URL}/dashboard/pos`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2500);
    const posOffline = await page.evaluate(() => ({
      bodyLen: document.body?.innerText?.length ?? 0,
      hasPos: /Point of Sale|POS|Complete Sale|Queue Cash Sale/i.test(
        document.body?.innerText ?? "",
      ),
    }));
    record(
      "POS loads offline after single login warm",
      posOffline.hasPos || posOffline.bodyLen > 200,
      `hasPos=${posOffline.hasPos} bodyLen=${posOffline.bodyLen}`,
    );

    await page.goto(`${APP_URL}/dashboard/hr-payroll/attendance`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2000);
    const attendanceOffline = await page.evaluate(() =>
      /Attendance|attendance/i.test(document.body?.innerText ?? ""),
    );
    record(
      "Attendance loads offline after single login warm",
      attendanceOffline,
      `found=${attendanceOffline}`,
    );

    await page.goto(`${APP_URL}/dashboard/finance/expenses`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2000);
    const expenseOffline = await page.evaluate(() =>
      /Expense|expense/i.test(document.body?.innerText ?? ""),
    );
    record(
      "Expense loads offline after single login warm",
      expenseOffline,
      `found=${expenseOffline}`,
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
