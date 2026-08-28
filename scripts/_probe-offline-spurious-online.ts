/**
 * Variant repro: multi-line sale 2 + spurious online event between sales.
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
  await page.waitForTimeout(500);
}

async function readOnlineState(page: Page) {
  return page.evaluate(() => ({
    onLine: navigator.onLine,
    queueBtn: !!document.querySelector('button[type="submit"]')?.textContent?.includes("Queue Cash Sale"),
    completeBtn: !!document.querySelector('button[type="submit"]')?.textContent?.includes("Complete Sale"),
    partial: document.body.innerText.includes("Partial checkout"),
    pending: document.body.innerText.includes("Pending sync"),
    failed: document.body.innerText.includes("Failed to fetch"),
    submit: document.querySelector('button[type="submit"]')?.textContent?.trim(),
  }));
}

async function state(page: Page) {
  return readOnlineState(page);
}

async function main() {
  loadEnvFromArgv(["--env-file", ".env.staging.local"]);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  const email = `offline.race.${stamp}@test.davors`;
  const password = `Race-${stamp}!Aa8`;
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { portal: "staff" } });
  await admin.from("user_accounts").insert({ auth_uid: u!.user!.id, email, role: "super_admin", is_active: true, tenant_id: DAVORS });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  let rpc = 0;
  page.on("request", (r) => {
    if (r.url().includes("create_product_sale")) rpc += 1;
  });

  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /Sign In/i }).click();
  await page.waitForURL("**/dashboard**", { timeout: 90000 });
  await page.goto(`${APP}/dashboard/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await goOffline(context, page);

  // Sale 1 single line
  await page.locator('input[type="search"]').fill("a");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Add to Cart" }).first().click();
  await page.waitForTimeout(400);
  const paySelect = page.locator("select").filter({ has: page.locator('option:has-text("Cash")') }).last();
  await paySelect.selectOption({ label: "Cash" });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2000);
  const after1 = await state(page);
  console.log("after sale1:", after1);
  record("sale 1 queued offline", after1.pending && !after1.partial, JSON.stringify(after1));
  record("sale 1 no RPC", rpc === 0, `rpc=${rpc}`);

  await page.getByRole("button", { name: "New Sale" }).click();
  await page.waitForTimeout(500);

  // *** Simulate spurious online event while navigator.onLine is still false ***
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(300);
  const afterSpurious = await state(page);
  console.log("after spurious online:", afterSpurious);
  record(
    "navigator.onLine still false after spurious online",
    !afterSpurious.onLine,
    JSON.stringify(afterSpurious),
  );
  record(
    "React still treats session as offline (Queue btn, not Complete)",
    afterSpurious.queueBtn && !afterSpurious.completeBtn,
    JSON.stringify(afterSpurious),
  );

  // Sale 2 multi-line (3 products)
  await page.locator('input[type="search"]').fill("a");
  await page.waitForTimeout(300);
  const addBtns = page.getByRole("button", { name: "Add to Cart" });
  const n = Math.min(await addBtns.count(), 3);
  for (let i = 0; i < n; i += 1) {
    if (!(await addBtns.nth(i).isDisabled())) {
      await addBtns.nth(i).click();
      await page.waitForTimeout(250);
    }
  }
  await paySelect.selectOption({ label: "Cash" });
  rpc = 0;
  const submitLabel = await page.locator('button[type="submit"]').first().textContent();
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const after2 = await state(page);
  console.log("sale2 submit was:", submitLabel?.trim());
  console.log("after sale2:", after2, "rpc=", rpc);
  record(
    "sale 2 queued offline (pending sync, no partial)",
    after2.pending && !after2.partial,
    JSON.stringify(after2),
  );
  record(
    "sale 2 no create_product_sale RPC",
    rpc === 0,
    `rpc=${rpc}`,
  );
  record(
    "sale 2 did NOT hit online partial/failed path",
    !after2.partial && !after2.failed,
    JSON.stringify(after2),
  );

  await browser.close();
  await admin.from("user_accounts").delete().eq("auth_uid", u!.user!.id);
  await admin.auth.admin.deleteUser(u!.user!.id);

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch(console.error);
