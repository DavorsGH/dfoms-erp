/**
 * Browser checks for dashboard cache freshness label.
 *
 * Staging:
 *   npx tsx scripts/test-cache-stale-indicator-staging-browser.ts --env-file .env.staging.local
 *
 * Production:
 *   $env:APP_URL="https://portal.davorsfacilities.com"
 *   npx tsx scripts/test-cache-stale-indicator-staging-browser.ts --env-file .env.local.backup
 */
import { chromium, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

const APP_URL = (
  process.env.APP_URL ??
  process.env.STAGING_APP_URL ??
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
).replace(/\/$/, "");
const USE_BYPASS = APP_URL.includes("vercel.app");
const BYPASS =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ??
  "IJ7aYbMjtmTzXvZFVY1MdDdZYAlZcIDq";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

type Check = { step: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(step: string, pass: boolean, detail: string) {
  checks.push({ step, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
}

function appUrl(path: string) {
  const url = new URL(path, APP_URL);
  if (USE_BYPASS) {
    url.searchParams.set("x-vercel-set-bypass-cookie", "true");
    url.searchParams.set("x-vercel-protection-bypass", BYPASS);
  }
  return url.toString();
}

async function createProbeUser(url: string, serviceKey: string) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  const email = `cache-stale.${stamp}@test.davors`;
  const password = `CacheStale-${stamp}!Aa8`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (error || !data.user) throw new Error(error?.message ?? "createUser failed");
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

async function deleteProbeUser(url: string, serviceKey: string, authUid: string) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await admin.from("user_accounts").delete().eq("auth_uid", authUid);
  await admin.auth.admin.deleteUser(authUid);
}

async function freshnessLabel(page: Page) {
  const el = page.locator("text=/Updated (just now|\\d+ min ago)/").first();
  await el.waitFor({ state: "visible", timeout: 30000 });
  return el.innerText();
}

async function hasFreshFlash(page: Page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("span"));
    return nodes.some(
      (n) =>
        n.textContent?.includes("Updated ") &&
        n.className.includes("bg-amber-100"),
    );
  });
}

async function inspectIndexedDb(page: Page) {
  return page.evaluate(async () => {
    const dbName = "dfoms-client-cache";
    const dbs = (await indexedDB.databases?.()) ?? [];
    const dbInfo = dbs.find((d) => d.name === dbName);
    if (!dbInfo) {
      return { exists: false, count: 0, keys: [] as string[] };
    }
    return new Promise<{ exists: boolean; count: number; keys: string[] }>(
      (resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("entries")) {
            resolve({ exists: true, count: 0, keys: [] });
            db.close();
            return;
          }
          const tx = db.transaction("entries", "readonly");
          const store = tx.objectStore("entries");
          const getAll = store.getAllKeys();
          getAll.onsuccess = () => {
            const keys = getAll.result.map(String);
            resolve({ exists: true, count: keys.length, keys });
            db.close();
          };
          getAll.onerror = () => reject(getAll.error);
        };
      },
    );
  });
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  console.log(`Target: ${APP_URL}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase env");
  }

  const probe = await createProbeUser(supabaseUrl, serviceKey);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(appUrl("/login"), { waitUntil: "networkidle" });
    await page.locator("#email").fill(probe.email);
    await page.locator("#password").fill(probe.password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.waitForURL("**/dashboard**", { timeout: 90000 });
    await page.waitForSelector("h1:has-text('Dashboard')", { timeout: 60000 });

    let flashAfterMount = false;
    for (let i = 0; i < 15; i += 1) {
      if (await hasFreshFlash(page)) {
        flashAfterMount = true;
        break;
      }
      await page.waitForTimeout(200);
    }

    const initial = await freshnessLabel(page);
    record(
      "Initial label is 'Updated just now'",
      initial.includes("just now"),
      initial,
    );
    record(
      "Yellow flash after initial cache write",
      flashAfterMount,
      flashAfterMount ? "bg-amber-100 seen within 3s" : "no flash class",
    );

    await page.waitForTimeout(35_000);
    const after35s = await freshnessLabel(page);
    const flashAfterIdle = await hasFreshFlash(page);
    record(
      "Label still 'just now' before 1 minute elapses",
      after35s.includes("just now"),
      after35s,
    );
    record(
      "No flash during idle time passing",
      !flashAfterIdle,
      flashAfterIdle ? "unexpected flash" : "no flash class",
    );

    // 30s tick can lag up to ~90s before first "1 min ago" once cachedAt settles after IDB write.
    await page.waitForTimeout(60_000);
    const after95s = await freshnessLabel(page);
    record(
      "Label progresses to '1 min ago' after ~95s total",
      after95s.includes("1 min ago"),
      after95s,
    );

    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByRole("button", { name: "Refresh" }).waitFor({
      state: "visible",
      timeout: 30000,
    });

    let flashAfterRefresh = false;
    for (let i = 0; i < 15; i += 1) {
      if (await hasFreshFlash(page)) {
        flashAfterRefresh = true;
        break;
      }
      await page.waitForTimeout(200);
    }

    const afterRefresh = await freshnessLabel(page);
    record(
      "Refresh resets label to 'just now'",
      afterRefresh.includes("just now"),
      afterRefresh,
    );
    record(
      "Yellow flash on manual Refresh",
      flashAfterRefresh,
      flashAfterRefresh ? "bg-amber-100 seen within 3s" : "no flash class",
    );

    // Dashboard regression checks (online data paths unchanged).
    const netProfitVisible = await page
      .getByText(/Net Profit/i)
      .first()
      .isVisible()
      .catch(() => false);
    record(
      "Dashboard Net Profit card visible",
      netProfitVisible,
      netProfitVisible ? "Net Profit card found" : "Net Profit card not found",
    );

    const offlineBannerVisible = await page
      .getByText(/Offline — data may be outdated/i)
      .isVisible()
      .catch(() => false);
    record(
      "No offline banner while online",
      !offlineBannerVisible,
      offlineBannerVisible ? "unexpected offline banner" : "no offline banner",
    );

    await page.waitForTimeout(2000);
    const idb = await inspectIndexedDb(page);
    record(
      "IndexedDB cache populated after dashboard load",
      idb.count >= 1 &&
        idb.keys.some((k) => k.includes("dashboard-summary")),
      `count=${idb.count}, keys=${idb.keys.join(", ") || "(none)"}`,
    );
  } finally {
    await browser.close();
    await deleteProbeUser(supabaseUrl, serviceKey, probe.authUid);
  }

  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
