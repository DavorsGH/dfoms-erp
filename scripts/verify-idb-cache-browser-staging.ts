/**
 * End-to-end browser verification for IndexedDB cache purge + offline UX.
 * Usage: npx tsx scripts/verify-idb-cache-browser-staging.ts --env-file .env.staging.local
 */
import { chromium, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

const APP_URL = (process.env.STAGING_APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

type CheckResult = { step: string; pass: boolean; detail: string };
const results: CheckResult[] = [];

function record(step: string, pass: boolean, detail: string) {
  results.push({ step, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
}

async function inspectIndexedDb(page: Page) {
  return page.evaluate(async () => {
    const dbName = "dfoms-client-cache";
    const dbs = (await indexedDB.databases?.()) ?? [];
    const dbInfo = dbs.find((d) => d.name === dbName);
    if (!dbInfo) {
      return { exists: false, deleted: true, keys: [] as string[], count: 0 };
    }

    return new Promise<{
      exists: boolean;
      deleted: boolean;
      keys: string[];
      count: number;
    }>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("entries")) {
          resolve({ exists: true, deleted: false, keys: [], count: 0 });
          db.close();
          return;
        }
        const tx = db.transaction("entries", "readonly");
        const store = tx.objectStore("entries");
        const getAll = store.getAllKeys();
        getAll.onsuccess = () => {
          const keys = getAll.result.map(String);
          resolve({
            exists: true,
            deleted: false,
            keys,
            count: keys.length,
          });
          db.close();
        };
        getAll.onerror = () => reject(getAll.error);
      };
    });
  });
}

async function login(page: Page, email: string, password: string) {
  await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/dashboard**", { timeout: 60000 });
  await page.waitForSelector("h1:has-text('Dashboard')", { timeout: 60000 });
}

async function createProbeUser(
  url: string,
  serviceKey: string,
): Promise<{ email: string; password: string; authUid: string }> {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const email = `idb-browser.${stamp}@test.davors`;
  const password = `IdbBrowser-${stamp}!Aa8`;

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (authError || !authData.user) {
    throw new Error(authError?.message ?? "createUser failed");
  }

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

  return { email, password, authUid };
}

async function deleteProbeUser(url: string, serviceKey: string, authUid: string) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await admin.from("user_accounts").delete().eq("auth_uid", authUid);
  await admin.auth.admin.deleteUser(authUid);
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing staging Supabase env");
  }

  const probe = await createProbeUser(supabaseUrl, serviceKey);
  console.log(`Probe user: ${probe.email}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page, probe.email, probe.password);

    // Wait for cache write (DashboardCacheShell useEffect)
    await page.waitForTimeout(2000);
    const idbAfterLogin = await inspectIndexedDb(page);
    record(
      "Dashboard cache populated after login",
      idbAfterLogin.count >= 1 &&
        idbAfterLogin.keys.some((k: string) => k.includes("dashboard-summary")),
      `count=${idbAfterLogin.count}, keys=${idbAfterLogin.keys.join(", ") || "(none)"}`,
    );

    const netProfitVisible = await page
      .getByText(/Net Profit/i)
      .first()
      .isVisible()
      .catch(() => false);
    record(
      "Dashboard summaries visible online",
      netProfitVisible,
      netProfitVisible ? "Net Profit card found" : "Net Profit card not found",
    );

    await page.getByRole("button", { name: "Log Out" }).click();
    await page.waitForURL("**/login**", { timeout: 30000 });

    const idbAfterLogout = await inspectIndexedDb(page);
    const purgeOk =
      idbAfterLogout.deleted ||
      !idbAfterLogout.exists ||
      idbAfterLogout.count === 0;
    record(
      "Logout purges IndexedDB (0 keys or DB deleted)",
      purgeOk,
      idbAfterLogout.deleted
        ? "database deleted"
        : `exists=${idbAfterLogout.exists}, count=${idbAfterLogout.count}, keys=${idbAfterLogout.keys.join(", ") || "(none)"}`,
    );

    // Offline behavior — re-login on dashboard first
    await login(page, probe.email, probe.password);
    await page.waitForTimeout(2000);

    const idbBeforeOffline = await inspectIndexedDb(page);
    record(
      "Cache repopulated after re-login",
      idbBeforeOffline.count >= 1,
      `count=${idbBeforeOffline.count}`,
    );

    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
    });
    await page.waitForTimeout(1000);

    const offlineBanner = page.getByText(
      /Offline — data may be outdated/i,
    );
    const bannerVisible = await offlineBanner.isVisible().catch(() => false);
    record(
      "Offline banner appears on dashboard",
      bannerVisible,
      bannerVisible ? "banner visible" : "banner not found",
    );

    const summaryStillVisible = await page
      .getByText(/Net Profit/i)
      .first()
      .isVisible()
      .catch(() => false);
    record(
      "Cached dashboard summaries still visible offline",
      summaryStillVisible,
      summaryStillVisible ? "Net Profit card still visible" : "summaries missing",
    );

    await context.setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
    });
    await page.goto(`${APP_URL}/dashboard/administration/expense-categories`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("h2:has-text('Expense Categories')", {
      timeout: 30000,
    });

    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
    });
    await page.waitForTimeout(1000);

    const offlineWriteBanner = page.getByText(
      /You are offline\. Cached data is read-only/i,
    );
    const writeBannerVisible = await offlineWriteBanner
      .isVisible()
      .catch(() => false);
    record(
      "Expense categories shows offline write warning",
      writeBannerVisible,
      writeBannerVisible ? "offline write message visible" : "message not found",
    );

    const categoryName = `IDB-OFFLINE-TEST-${Date.now()}`;
    await page.getByPlaceholder("Category name").fill(categoryName);
    const addButton = page.getByRole("button", { name: "Add" });
    const addDisabled = await addButton.isDisabled();
    await addButton.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(500);

    const blockedMessage = await page
      .getByText(/You are offline\. Cached data is read-only/i)
      .isVisible()
      .catch(() => false);
    const rowAdded = await page
      .getByText(categoryName)
      .isVisible()
      .catch(() => false);
    record(
      "Write action blocked offline (add expense category)",
      (blockedMessage || addDisabled) && !rowAdded,
      `addDisabled=${addDisabled}, blockedMessage=${blockedMessage}, rowAdded=${rowAdded}`,
    );

    await context.setOffline(false);
  } finally {
    await browser.close();
    await deleteProbeUser(supabaseUrl, serviceKey, probe.authUid);
    console.log(`Cleaned up probe user ${probe.authUid}`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  if (failed.length > 0) {
    console.error("\nFailed steps:");
    for (const row of failed) {
      console.error(`  - ${row.step}: ${row.detail}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
