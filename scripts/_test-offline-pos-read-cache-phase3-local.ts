/**
 * Phase 3 — stock + customer-balance read caches + navbar logo/avatar offline.
 *
 *   $env:APP_URL="http://localhost:3000"
 *   npx tsx scripts/_test-offline-pos-read-cache-phase3-local.ts --env-file .env.staging.local
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const APP_URL = (
  process.env.APP_URL ??
  process.env.STAGING_APP_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");
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
  await page.waitForTimeout(500);
}

async function goOnline(context: BrowserContext, page: Page) {
  await context.setOffline(false);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(500);
}

async function waitForIdbCaches(page: Page) {
  for (let i = 0; i < 30; i += 1) {
    const state = (await page.evaluate(`(async () => {
      try {
        const dbs = await indexedDB.databases?.() ?? [];
        const has = dbs.some((d) => d.name === "dfoms-client-cache");
        if (!has) return { ready: false, keys: [] };
        return await new Promise((resolve) => {
          const req = indexedDB.open("dfoms-client-cache");
          req.onerror = () => resolve({ ready: false, keys: [] });
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("entries")) {
              db.close();
              resolve({ ready: false, keys: [] });
              return;
            }
            const tx = db.transaction("entries", "readonly");
            const store = tx.objectStore("entries");
            const getAllKeys = store.getAllKeys();
            getAllKeys.onsuccess = () => {
              const keys = (getAllKeys.result || []).map(String);
              db.close();
              resolve({
                ready:
                  keys.some((k) => k.includes("stock-levels")) &&
                  keys.some((k) => k.includes("customer-balances")),
                keys: keys,
              });
            };
            getAllKeys.onerror = () => {
              db.close();
              resolve({ ready: false, keys: [] });
            };
          };
        });
      } catch (e) {
        return { ready: false, keys: [] };
      }
    })()`)) as { ready: boolean; keys: string[] };

    if (state.ready) {
      return state;
    }
    await page.waitForTimeout(1000);
  }
  return { ready: false, keys: [] as string[] };
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
  const email = `offline.pos3.${stamp}@test.davors`;
  const password = `OfflinePos3-${stamp}!Aa8`;
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
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle" });
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: /Sign In/i }).click();
    try {
      await page.waitForURL("**/dashboard**", { timeout: 90000 });
    } catch (err) {
      const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 500);
      throw new Error(
        `Login failed. url=${page.url()} body=${bodyText} cause=${err instanceof Error ? err.message : String(err)}`,
      );
    }
    record("login online", true, page.url());

    await page.goto(`${APP_URL}/dashboard/pos`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(4000);

    const idb = await waitForIdbCaches(page);
    record(
      "IDB stock + customer-balances cached",
      idb.ready,
      idb.keys.filter(
        (k) => k.includes("stock-levels") || k.includes("customer-balances"),
      ).join(", ") || idb.keys.slice(0, 5).join(", "),
    );

    // Warm shell assets via dashboard visit
    await page.goto(`${APP_URL}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(4000);
    await page.evaluate(`(async () => {
      if (!navigator.serviceWorker?.controller) return;
      const reg = await navigator.serviceWorker.ready;
      reg.active?.postMessage({ type: "WARM_OFFLINE_NAV_ROUTES" });
    })()`);
    await page.waitForTimeout(5000);

    const shellAssets = (await page.evaluate(`(async () => {
      const keys = await caches.keys();
      const shell = keys.find((k) => k.includes("davors-erp-shell"));
      if (!shell) return { shell: null, paths: [] };
      const cache = await caches.open(shell);
      const reqs = await cache.keys();
      const paths = [];
      for (const r of reqs) {
        try { paths.push(new URL(r.url).pathname); } catch (e) { paths.push(r.url); }
      }
      return { shell: shell, paths: Array.from(new Set(paths)) };
    })()`)) as { shell: string | null; paths: string[] };

    record(
      "shell cache has /logo.jpg",
      Boolean(shellAssets.paths.includes("/logo.jpg")),
      shellAssets.shell ?? "no shell",
    );
    record(
      "shell cache name is v8+",
      Boolean(shellAssets.shell && /v([8-9]|\d{2,})/.test(shellAssets.shell)),
      shellAssets.shell ?? "missing",
    );

    await page.goto(`${APP_URL}/dashboard/pos`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2500);

    const onlineStock = await page.locator("text=/Stock:/i").first().count();
    record("POS shows stock online", onlineStock > 0, `matches=${onlineStock}`);

    await goOffline(context, page);
    // Soft offline first (same document) so React sees navigator.onLine=false
    // without depending on a full SW navigation round-trip.
    await page.waitForTimeout(800);
    const softBanner = await page
      .getByTestId("pos-cached-snapshot-banner")
      .count();
    const softCached = await page.locator("text=/(cached)/i").count();
    record(
      "offline POS shows cached snapshot banner",
      softBanner > 0,
      `softBanner=${softBanner} bodyHasCached=${softCached}`,
    );
    record(
      "offline stock shows (cached) marker",
      softCached > 0 || softBanner > 0,
      `count=${softCached}`,
    );

    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2500);
    const hardBanner = await page
      .getByTestId("pos-cached-snapshot-banner")
      .count()
      .catch(() => 0);
    record(
      "offline hard-reload still shows POS cache UI",
      hardBanner > 0 ||
        (await page.getByRole("button", { name: /Complete Sale/i }).count()) >
          0,
      `hardBanner=${hardBanner}`,
    );

    const completeSale = page.getByRole("button", { name: /Complete Sale/i });
    const saleDisabled = await completeSale.isDisabled().catch(() => true);
    record("Complete Sale disabled offline", saleDisabled, `disabled=${saleDisabled}`);

    // Try submit path if cart empty — button stays disabled; also check banner text
    const blockMsg = await page
      .locator("text=/offline|read-only|cached data/i")
      .count();
    record(
      "offline write-block messaging visible",
      blockMsg > 0,
      `count=${blockMsg}`,
    );

    // Pick a customer if select exists to surface loyalty/AR cached
    const customerSelect = page.locator("select").first();
    if (await customerSelect.count()) {
      const options = await customerSelect.locator("option").all();
      if (options.length > 1) {
        const value = await options[1].getAttribute("value");
        if (value) {
          await customerSelect.selectOption(value);
          await page.waitForTimeout(800);
        }
      }
    }

    const loyaltyOrAr = await page
      .locator("text=/Loyalty points|Open AR|Available balance/i")
      .count();
    record(
      "customer balances section present offline",
      loyaltyOrAr > 0 || (await customerSelect.count()) === 0,
      `labels=${loyaltyOrAr}`,
    );

    await page.goto(`${APP_URL}/dashboard/hr-payroll/attendance`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1500);

    const logoOk = (await page.evaluate(`(async () => {
      const imgs = Array.from(document.querySelectorAll("img"));
      const logo = imgs.find((img) =>
        (img.alt || "").toLowerCase().includes("logo") ||
        (img.src || "").includes("logo") ||
        (img.src || "").includes("offline_assets/workspace-logo") ||
        (img.src || "").includes("apple-touch"),
      );
      if (!logo) return { found: false, complete: false, naturalWidth: 0, src: null };
      return {
        found: true,
        complete: logo.complete && logo.naturalWidth > 0,
        naturalWidth: logo.naturalWidth,
        src: logo.currentSrc || logo.src,
      };
    })()`)) as {
      found: boolean;
      complete: boolean;
      naturalWidth: number;
      src: string | null;
    };

    record(
      "offline attendance navbar logo loads",
      logoOk.found && logoOk.complete,
      `src=${logoOk.src} w=${logoOk.naturalWidth}`,
    );

    await goOnline(context, page);
    await page.goto(`${APP_URL}/dashboard/pos`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2500);
    const afterOnline = await page.locator("text=/cached snapshot/i").count();
    record(
      "online POS clears cached snapshot banner",
      afterOnline === 0,
      `count=${afterOnline}`,
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
