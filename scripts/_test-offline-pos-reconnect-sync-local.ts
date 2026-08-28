/**
 * Genuine reconnection: queue offline sale → go online → sync completes.
 *
 *   npx tsx scripts/_test-offline-pos-reconnect-sync-local.ts --env-file .env.staging.local
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DAVORS = "00000001-0000-4000-8000-000000000001";

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

async function goOnline(context: BrowserContext, page: Page) {
  await context.setOffline(false);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(800);
}

async function queueCount(page: Page) {
  return page.evaluate(`(async () => {
    return await new Promise((resolve) => {
      const req = indexedDB.open("dfoms-client-cache");
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("write_queue")) { db.close(); resolve(0); return; }
        const tx = db.transaction("write_queue", "readonly");
        const all = tx.objectStore("write_queue").getAll();
        all.onsuccess = () => {
          db.close();
          resolve((all.result || []).filter((i) => i.type === "pos_cash_sale" && i.status !== "synced").length);
        };
        all.onerror = () => { db.close(); resolve(-1); };
      };
      req.onerror = () => resolve(-1);
    });
  })()`);
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const stamp = Date.now();
  const email = `offline.reconnect.${stamp}@test.davors`;
  const password = `Reconnect-${stamp}!Aa8`;
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  await admin.from("user_accounts").insert({
    auth_uid: u!.user!.id,
    email,
    role: "super_admin",
    is_active: true,
    tenant_id: DAVORS,
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let syncOfflineRpcCount = 0;
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("sync_offline_pos_cash_sale")) {
      syncOfflineRpcCount += 1;
    }
  });

  try {
    await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: /Sign In/i }).click();
    await page.waitForURL("**/dashboard**", { timeout: 90000 });

    await page.goto(`${APP}/dashboard/pos`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);

    await goOffline(context, page);
    const offlineState = await page.evaluate(() => ({
      onLine: navigator.onLine,
      queueBtn: document.querySelector('button[type="submit"]')?.textContent?.includes("Queue Cash Sale"),
    }));
    record("offline before queue", !offlineState.onLine, JSON.stringify(offlineState));

    await page.locator('input[type="search"]').fill("a");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Add to Cart" }).first().click();
    await page.waitForTimeout(400);
    const paySelect = page.locator("select").filter({ has: page.locator('option:has-text("Cash")') }).last();
    await paySelect.selectOption({ label: "Cash" });
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(2500);

    const pendingReceipt = await page.evaluate(() =>
      document.body.innerText.includes("Pending sync"),
    );
    record("sale queued with pending sync receipt", pendingReceipt, String(pendingReceipt));

    const openBefore = await queueCount(page);
    record("IDB has open pos_cash_sale item", openBefore === 1, `count=${openBefore}`);

    await goOnline(context, page);
    const onlineState = await page.evaluate(() => navigator.onLine);
    record("navigator.onLine true after reconnect", onlineState, String(onlineState));

    for (let i = 0; i < 20; i += 1) {
      const open = await queueCount(page);
      if (open === 0) break;
      await page.waitForTimeout(1500);
    }

    const openAfter = await queueCount(page);
    record("queue drained after reconnect", openAfter === 0, `open=${openAfter}`);
    record(
      "sync invoked sync_offline_pos_cash_sale RPC",
      syncOfflineRpcCount > 0,
      `rpc=${syncOfflineRpcCount}`,
    );
  } finally {
    await browser.close();
    await admin.from("user_accounts").delete().eq("auth_uid", u!.user!.id);
    await admin.auth.admin.deleteUser(u!.user!.id);
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
