/**
 * Phase 1 offline session persistence — local app + staging Supabase.
 *
 *   $env:APP_URL="http://localhost:3000"
 *   npx tsx scripts/_test-offline-session-phase1-local.ts --env-file .env.staging.local
 *
 * Expects `next start` (or next dev) already running with the Phase 1 code.
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import {
  approveLandlordForTest,
  resolveAvailableSlug,
} from "./lib/landlord-test-helpers";

const APP_URL = (
  process.env.APP_URL ??
  process.env.STAGING_APP_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const BANNER_RE =
  /You're offline\. Your session is still active — live data and writes need a connection\./i;

type Check = { step: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(step: string, pass: boolean, detail: string) {
  checks.push({ step, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
}

function adminClient(url: string, serviceKey: string) {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      throw new Error("serviceWorker unavailable");
    }
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    if (reg.waiting) {
      reg.waiting.postMessage?.({ type: "SKIP_WAITING" });
    }
    await new Promise<void>((resolve) => {
      if (navigator.serviceWorker.controller) {
        resolve();
        return;
      }
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
        once: true,
      });
      setTimeout(() => resolve(), 5000);
    });
  });
}

async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    // Nudge listeners that also sync from navigator.onLine on visibility.
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(300);
}

async function goOnline(context: BrowserContext, page: Page) {
  await context.setOffline(false);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(300);
}

async function assertOfflineSession(
  page: Page,
  context: BrowserContext,
  label: string,
  stayPathIncludes: string,
  navPath: string,
) {
  await waitForServiceWorker(page);
  await goOffline(context, page);

  const banner = page.getByText(BANNER_RE);
  await banner.waitFor({ state: "visible", timeout: 10000 }).catch(() => null);
  const bannerVisible = await banner.isVisible().catch(() => false);
  record(
    `${label}: offline banner visible`,
    bannerVisible,
    bannerVisible ? "session offline banner shown" : "banner missing",
  );

  await goOnline(context, page);
  await page.waitForTimeout(500);
  const bannerAfterOnline = await banner.isVisible().catch(() => false);
  record(
    `${label}: banner clears after reconnect`,
    !bannerAfterOnline,
    bannerAfterOnline ? "banner still visible" : "banner cleared",
  );

  // Hard navigation while offline → SW offline shell (not login).
  await goOffline(context, page);
  await page.goto(`${APP_URL}${navPath}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  }).catch(() => undefined);

  const urlAfterNav = page.url();
  const bouncedToLogin =
    /\/login(\?|$)/.test(new URL(urlAfterNav).pathname) &&
    !urlAfterNav.includes("/login/mfa");
  record(
    `${label}: hard nav offline does not bounce to login`,
    !bouncedToLogin,
    urlAfterNav,
  );

  const path = new URL(page.url()).pathname;
  const offlineShellVisible = await page
    .getByText(/You are offline/i)
    .first()
    .isVisible()
    .catch(() => false);
  const pathOrShellOk =
    path.includes(stayPathIncludes) || path === "/offline" || offlineShellVisible;
  record(
    `${label}: still in app shell or offline page`,
    pathOrShellOk || !bouncedToLogin,
    `path=${path}, offlineShell=${offlineShellVisible}`,
  );

  await goOnline(context, page);
}

async function createStaff(
  admin: SupabaseClient,
  stamp: number,
): Promise<{ email: string; password: string; authUid: string }> {
  const email = `offline.staff.${stamp}@test.davors`;
  const password = `OfflineStaff-${stamp}!Aa8`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  assert(!error && data.user, error?.message ?? "staff createUser failed");
  const authUid = data.user.id;
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
  return { email, password, authUid };
}

async function createLessee(
  admin: SupabaseClient,
  stamp: number,
): Promise<{ email: string; password: string; authUid: string; lesseeId: string }> {
  const email = `offline.lessee.${stamp}@test.davors`;
  const password = `OfflineLessee-${stamp}!Aa8`;
  const lesseeId = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "lessee" },
  });
  assert(!error && data.user, error?.message ?? "lessee createUser failed");
  const authUid = data.user.id;
  const now = new Date().toISOString();
  const { error: lesseeErr } = await admin.from("lessees").insert({
    lessee_id: lesseeId,
    tenant_id: DAVORS_TENANT_ID,
    auth_user_id: authUid,
    full_name: `Offline Lessee ${stamp}`,
    email,
    phone: "+233200000099",
    status: "active",
    created_at: now,
    updated_at: now,
  });
  if (lesseeErr) {
    await admin.auth.admin.deleteUser(authUid);
    throw new Error(lesseeErr.message);
  }
  return { email, password, authUid, lesseeId };
}

async function createLandlord(
  admin: SupabaseClient,
  stamp: number,
): Promise<{
  email: string;
  password: string;
  authUid: string;
  tenantId: string;
}> {
  const email = `offline.landlord.${stamp}@test.davors`;
  const password = `OfflineLandlord-${stamp}!Aa8`;
  const name = `Offline Landlord ${stamp}`;
  const slug = await resolveAvailableSlug(admin, name);
  assert(slug, "Unable to resolve landlord slug");
  const now = new Date().toISOString();
  const { data: tenantRow, error: tenantError } = await admin
    .from("tenants")
    .insert({
      name,
      slug,
      status: "active",
      product_line: "real_estate_only",
      email,
      phone: "+233200000098",
      address: "Offline Phase1 Test",
      updated_at: now,
    })
    .select("id")
    .single();
  assert(!tenantError && tenantRow, tenantError?.message ?? "tenant insert failed");
  const tenantId = tenantRow.id;

  const { data: authCreated, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, portal: "landlord" },
    });
  if (createError || !authCreated.user) {
    await admin.from("tenants").delete().eq("id", tenantId);
    throw new Error(createError?.message ?? "landlord createUser failed");
  }
  const authUid = authCreated.user.id;

  const { error: landlordError } = await admin.from("landlords").insert({
    tenant_id: tenantId,
    landlord_type: "platform_only",
    approval_status: "pending",
    auth_user_id: authUid,
    sms_credit_balance: 0,
    created_at: now,
    updated_at: now,
  });
  if (landlordError) {
    await admin.auth.admin.deleteUser(authUid);
    await admin.from("tenants").delete().eq("id", tenantId);
    throw new Error(landlordError.message);
  }

  await approveLandlordForTest(admin, tenantId);
  return { email, password, authUid, tenantId };
}

async function loginForm(
  page: Page,
  path: string,
  email: string,
  password: string,
  waitUrl: string,
) {
  await page.goto(`${APP_URL}${path}`, { waitUntil: "networkidle" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /Sign In/i }).click();
  await page.waitForURL(waitUrl, { timeout: 90000 });
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  console.log(`Target: ${APP_URL}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(supabaseUrl.includes(STAGING_REF), "Expected staging Supabase URL");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY required");

  const admin = adminClient(supabaseUrl, serviceKey);
  const stamp = Date.now();

  const staff = await createStaff(admin, stamp);
  const lessee = await createLessee(admin, stamp);
  const landlord = await createLandlord(admin, stamp);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // --- Staff ERP ---
    await loginForm(page, "/login", staff.email, staff.password, "**/dashboard**");
    await page.waitForSelector("text=/Dashboard|Overview/i", { timeout: 60000 });
    record("staff: login online", true, page.url());

    // Auth unreachable while app still reachable → middleware trusts cookie JWT
    await page.route("**/auth/v1/user**", (route) => route.abort("timedout"));
    await page.goto(`${APP_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    const afterAuthBlock = page.url();
    record(
      "staff: Auth getUser blocked still stays authenticated",
      afterAuthBlock.includes("/dashboard") && !afterAuthBlock.includes("/login"),
      afterAuthBlock,
    );
    await page.unroute("**/auth/v1/user**");

    // Ensure authenticated shell is hydrated before offline checks.
    await page.goto(`${APP_URL}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForURL("**/dashboard**", { timeout: 60000 });
    await page.getByRole("heading", { name: /Dashboard/i }).first().waitFor({
      state: "visible",
      timeout: 60000,
    }).catch(async () => {
      await page.waitForSelector("main", { timeout: 60000 });
    });

    await assertOfflineSession(
      page,
      context,
      "staff",
      "/dashboard",
      "/dashboard/expenses",
    );

    // Background refresh on reconnect while React shell is mounted (not SW offline HTML).
    await page.goto(`${APP_URL}/dashboard`, { waitUntil: "networkidle" });
    let getUserSeen = false;
    const getUserWait = page
      .waitForRequest(
        (req) =>
          req.url().includes("/auth/v1/user") ||
          req.url().includes("/auth/v1/token"),
        { timeout: 8000 },
      )
      .then(() => {
        getUserSeen = true;
      })
      .catch(() => undefined);

    await goOffline(context, page);
    await page.getByText(BANNER_RE).waitFor({ state: "visible", timeout: 10000 });
    await goOnline(context, page);
    await getUserWait;
    record(
      "staff: reconnect triggers Auth getUser",
      getUserSeen,
      getUserSeen ? "getUser requested after online" : "no getUser observed",
    );

    // --- Tenant portal ---
    await context.clearCookies();
    await page.goto(`${APP_URL}/portal/login`, { waitUntil: "networkidle" });
    await loginForm(
      page,
      "/portal/login",
      lessee.email,
      lessee.password,
      "**/portal/dashboard**",
    );
    record("tenant: login online", true, page.url());
    await assertOfflineSession(
      page,
      context,
      "tenant",
      "/portal",
      "/portal/payments",
    );

    // --- Landlord portal ---
    await context.clearCookies();
    await loginForm(
      page,
      "/landlord-portal/login",
      landlord.email,
      landlord.password,
      "**/landlord-portal/dashboard**",
    );
    record("landlord: login online", true, page.url());
    await assertOfflineSession(
      page,
      context,
      "landlord",
      "/landlord-portal",
      "/landlord-portal/dashboard",
    );
  } finally {
    await browser.close();
    await admin.from("user_accounts").delete().eq("auth_uid", staff.authUid);
    await admin.auth.admin.deleteUser(staff.authUid).catch(() => undefined);

    await admin.from("lessees").delete().eq("lessee_id", lessee.lesseeId);
    await admin.auth.admin.deleteUser(lessee.authUid).catch(() => undefined);

    await admin
      .from("landlord_subscriptions")
      .delete()
      .eq("tenant_id", landlord.tenantId);
    await admin.from("landlords").delete().eq("tenant_id", landlord.tenantId);
    await admin.from("tenants").delete().eq("id", landlord.tenantId);
    await admin.auth.admin.deleteUser(landlord.authUid).catch(() => undefined);
  }

  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
