/**
 * Reproduce: queue offline sale #1, then immediately attempt sale #2 in same offline session.
 *
 *   npx tsx scripts/_test-offline-pos-double-queue-local.ts --env-file .env.staging.local
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

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

async function readOnlineState(page: Page) {
  return page.evaluate(() => ({
    navigatorOnLine: navigator.onLine,
    queueBtn: !!document.querySelector('button[type="submit"]')?.textContent?.includes("Queue Cash Sale"),
    completeBtn: !!document.querySelector('button[type="submit"]')?.textContent?.includes("Complete Sale"),
    partialBanner: document.body.innerText.includes("Partial checkout on invoice"),
    pendingSync: document.body.innerText.includes("Pending sync"),
    failedFetch: document.body.innerText.includes("Failed to fetch"),
  }));
}

async function waitForIdbStock(page: Page) {
  for (let i = 0; i < 25; i += 1) {
    const ok = await page.evaluate(`(async () => {
      const dbs = await indexedDB.databases?.() ?? [];
      if (!dbs.some((d) => d.name === "dfoms-client-cache")) return false;
      return await new Promise((resolve) => {
        const req = indexedDB.open("dfoms-client-cache");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("entries")) { db.close(); resolve(false); return; }
          const tx = db.transaction("entries", "readonly");
          const keys = tx.objectStore("entries").getAllKeys();
          keys.onsuccess = () => {
            db.close();
            resolve((keys.result || []).map(String).some((k) => k.includes("stock-levels")));
          };
          keys.onerror = () => { db.close(); resolve(false); };
        };
        req.onerror = () => resolve(false);
      });
    })()`);
    if (ok) return true;
    await page.waitForTimeout(800);
  }
  return false;
}

async function addFirstProduct(page: Page) {
  const search = page.locator('input[type="search"]');
  await search.fill("a");
  await page.waitForTimeout(400);
  const btn = page.getByRole("button", { name: "Add to Cart" }).first();
  if (await btn.isDisabled()) return false;
  await btn.click();
  await page.waitForTimeout(500);
  return (await page.locator("section:has(h2:text-is('Cart')) table tbody tr").count()) > 0;
}

async function selectCashPayment(page: Page) {
  const selects = page.locator("select");
  const count = await selects.count();
  for (let i = 0; i < count; i += 1) {
    const sel = selects.nth(i);
    const cashOption = sel.locator('option', { hasText: /^Cash$/i });
    if ((await cashOption.count()) > 0) {
      await sel.selectOption({ label: "Cash" });
      return true;
    }
  }
  return false;
}

async function submitCheckout(page: Page) {
  const submit = page.locator('form button[type="submit"]').first();
  const label = (await submit.textContent())?.trim() ?? "";
  await submit.click();
  await page.waitForTimeout(2500);
  return label;
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const stamp = Date.now();
  const email = `offline.double.${stamp}@test.davors`;
  const password = `Double-${stamp}!Aa8`;
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

  // Track RPC calls to detect online vs offline path
  let createProductSaleRpcCount = 0;
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("create_product_sale") || url.includes("/rpc/create_product_sale")) {
      createProductSaleRpcCount += 1;
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
    record("IDB stock cached", await waitForIdbStock(page), "stock-levels key");

    await goOffline(context, page);
    const offlineBefore = await readOnlineState(page);
    record(
      "offline before sale 1",
      !offlineBefore.navigatorOnLine,
      JSON.stringify(offlineBefore),
    );

    record("add to cart sale 1", await addFirstProduct(page), "cart line");
    record("select Cash sale 1", await selectCashPayment(page), "payment");
    const label1 = await submitCheckout(page);
    const after1 = await readOnlineState(page);
    record(
      "sale 1 submit label",
      label1.includes("Queue") || after1.pendingSync,
      `label=${label1} state=${JSON.stringify(after1)}`,
    );
    record(
      "sale 1 queued (pending sync receipt)",
      after1.pendingSync && !after1.partialBanner,
      JSON.stringify(after1),
    );
    record(
      "sale 1 no create_product_sale RPC",
      createProductSaleRpcCount === 0,
      `rpcCount=${createProductSaleRpcCount}`,
    );

    // New sale
    await page.getByRole("button", { name: "New Sale" }).click();
    await page.waitForTimeout(800);
    const afterNewSale = await readOnlineState(page);
    record(
      "after New Sale still offline",
      !afterNewSale.navigatorOnLine,
      JSON.stringify(afterNewSale),
    );
    record(
      "after New Sale shows Queue Cash Sale button when cart filled",
      afterNewSale.queueBtn || afterNewSale.completeBtn,
      JSON.stringify(afterNewSale),
    );

    createProductSaleRpcCount = 0;
    record("add to cart sale 2", await addFirstProduct(page), "cart line");
    record("select Cash sale 2", await selectCashPayment(page), "payment");

    const beforeSubmit2 = await readOnlineState(page);
    const label2 = await submitCheckout(page);
    const after2 = await readOnlineState(page);

    record(
      "sale 2 submit label",
      true,
      `label=${label2} before=${JSON.stringify(beforeSubmit2)} after=${JSON.stringify(after2)}`,
    );
    const sale2Queued = after2.pendingSync && !after2.partialBanner;
    const sale2OnlinePartial =
      after2.partialBanner || after2.failedFetch || createProductSaleRpcCount > 0;
    record(
      "sale 2 queued offline (expected)",
      sale2Queued,
      `pendingSync=${after2.pendingSync} partial=${after2.partialBanner} rpc=${createProductSaleRpcCount}`,
    );
    record(
      "sale 2 did NOT hit online partial path (bug if true)",
      !sale2OnlinePartial,
      `partial=${after2.partialBanner} failedFetch=${after2.failedFetch} rpc=${createProductSaleRpcCount}`,
    );

    const queueCount = await page.evaluate(`(async () => {
      return await new Promise((resolve) => {
        const req = indexedDB.open("dfoms-client-cache");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("write_queue")) { db.close(); resolve(0); return; }
          const tx = db.transaction("write_queue", "readonly");
          const all = tx.objectStore("write_queue").getAll();
          all.onsuccess = () => {
            db.close();
            resolve((all.result || []).filter((i) => i.type === "pos_cash_sale").length);
          };
          all.onerror = () => { db.close(); resolve(-1); };
        };
        req.onerror = () => resolve(-1);
      });
    })()`);
    record("IDB has 2 pos_cash_sale queue items", queueCount === 2, `count=${queueCount}`);
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
