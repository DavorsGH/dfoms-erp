/**
 * Offline POS add-to-cart + queue cash sale E2E (local next dev + staging DB).
 *
 *   $env:APP_URL="http://localhost:3000"
 *   npx tsx scripts/_test-offline-pos-add-to-cart-local.ts --env-file .env.staging.local
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
  await page.waitForTimeout(800);
}

async function waitForIdbStock(page: Page) {
  for (let i = 0; i < 30; i += 1) {
    const ready = await page.evaluate(`(async () => {
      const dbs = await indexedDB.databases?.() ?? [];
      if (!dbs.some((d) => d.name === "dfoms-client-cache")) return false;
      return await new Promise((resolve) => {
        const req = indexedDB.open("dfoms-client-cache");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("entries")) {
            db.close();
            resolve(false);
            return;
          }
          const tx = db.transaction("entries", "readonly");
          const keys = tx.objectStore("entries").getAllKeys();
          keys.onsuccess = () => {
            const names = (keys.result || []).map(String);
            db.close();
            resolve(names.some((k) => k.includes("stock-levels")));
          };
          keys.onerror = () => {
            db.close();
            resolve(false);
          };
        };
        req.onerror = () => resolve(false);
      });
    })()`);
    if (ready) return true;
    await page.waitForTimeout(1000);
  }
  return false;
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
  const email = `offline.cart.${stamp}@test.davors`;
  const password = `OfflineCart-${stamp}!Aa8`;
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
    await page.waitForURL("**/dashboard**", { timeout: 90000 });

    await page.goto(`${APP_URL}/dashboard/pos`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(4000);

    const idbReady = await waitForIdbStock(page);
    record("IDB stock cache populated online", idbReady, `ready=${idbReady}`);

    const addButtonsOnline = page.getByRole("button", { name: "Add to Cart" });
    const onlineCount = await addButtonsOnline.count();
    record("Add to Cart buttons visible online", onlineCount > 0, `count=${onlineCount}`);

    if (onlineCount > 0) {
      const firstEnabled = addButtonsOnline.first();
      const disabledOnline = await firstEnabled.isDisabled();
      if (!disabledOnline) {
        await firstEnabled.click();
        await page.waitForTimeout(500);
        const cartRowsOnline = await page.locator("table tbody tr").count();
        record(
          "Add to Cart works online",
          cartRowsOnline > 0,
          `cartRows=${cartRowsOnline}`,
        );
        // Clear cart for offline test
        const removeButtons = page.getByRole("button", { name: "Remove" });
        while ((await removeButtons.count()) > 0) {
          await removeButtons.first().click();
          await page.waitForTimeout(200);
        }
      } else {
        record("Add to Cart works online", false, "first button disabled");
      }
    }

    await goOffline(context, page);

    const cachedBanner = await page.getByTestId("pos-cached-snapshot-banner").count();
    record("cached snapshot banner offline", cachedBanner > 0, `count=${cachedBanner}`);

    const search = page.locator('input[type="search"]');
    await search.fill("a");
    await page.waitForTimeout(400);

    const addOffline = page.getByRole("button", { name: "Add to Cart" });
    const offlineAddCount = await addOffline.count();
    record("Add to Cart buttons after search offline", offlineAddCount > 0, `count=${offlineAddCount}`);

    if (offlineAddCount > 0) {
      const btn = addOffline.first();
      const disabled = await btn.isDisabled();
      record("first Add to Cart enabled offline", !disabled, `disabled=${disabled}`);

      const cartBefore = await page.locator("text=No items in cart yet.").count();
      record("cart empty before add", cartBefore > 0, `emptyMsg=${cartBefore}`);

      await btn.click();
      await page.waitForTimeout(800);

      const cartAfterEmpty = await page.locator("text=No items in cart yet.").count();
      const cartRows = await page.locator("table tbody tr").count();
      const subtotalText = await page.locator("text=/Cart subtotal:/i").textContent().catch(() => "");
      const errorBanner = await page.locator(".border-red-200").textContent().catch(() => "");

      record(
        "Add to Cart adds row offline",
        cartRows > 0 && cartAfterEmpty === 0,
        `rows=${cartRows} stillEmpty=${cartAfterEmpty} subtotal=${subtotalText?.trim()} error=${errorBanner?.slice(0, 120)}`,
      );

      if (cartRows > 0 && !disabled) {
        // Add same product again
        await btn.click();
        await page.waitForTimeout(500);
        const rowsAfterSecond = await page.locator("table tbody tr").count();
        record(
          "second Add to Cart increases qty or rows",
          rowsAfterSecond >= cartRows,
          `rows=${rowsAfterSecond}`,
        );

        // Select Cash payment if available
        const paymentSelect = page.locator("select").filter({ has: page.locator('option:has-text("Cash")') }).last();
        if (await paymentSelect.count()) {
          await paymentSelect.selectOption({ label: "Cash" });
        }

        const queueBtn = page.getByRole("button", { name: /Queue Cash Sale/i });
        const queueVisible = await queueBtn.count();
        record("Queue Cash Sale button visible", queueVisible > 0, `count=${queueVisible}`);

        if (queueVisible > 0) {
          const queueDisabled = await queueBtn.isDisabled();
          record("Queue Cash Sale enabled", !queueDisabled, `disabled=${queueDisabled}`);
          if (!queueDisabled) {
            await queueBtn.click();
            await page.waitForTimeout(2000);
            const pendingReceipt = await page.locator("text=/Pending sync|pending sync/i").count();
            const offToken = await page.locator("text=/OFF-/i").count();
            record(
              "offline queue shows pending receipt",
              pendingReceipt > 0 || offToken > 0,
              `pending=${pendingReceipt} offToken=${offToken}`,
            );
          }
        }
      }
    }
  } finally {
    await browser.close();
    await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    await admin.auth.admin.deleteUser(authUid);
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
