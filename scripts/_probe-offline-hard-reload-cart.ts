import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

loadEnvFromArgv(["--env-file", ".env.staging.local"]);
const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DAVORS = "00000001-0000-4000-8000-000000000001";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const stamp = Date.now();
  const email = `offline.hard.${stamp}@test.davors`;
  const password = `Hard-${stamp}!Aa8`;
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
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /Sign In/i }).click();
  await page.waitForURL("**/dashboard**", { timeout: 90000 });
  await page.goto(`${APP}/dashboard/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  const swCount = await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).length,
  );
  console.log("SW registrations after POS visit (dev should be 0):", swCount);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.waitForTimeout(500);

  // Soft offline add
  await page.getByRole("button", { name: "Add to Cart" }).first().click();
  await page.waitForTimeout(800);
  const softRows = await page.locator("section:has(h2:text-is('Cart')) table tbody tr").count();
  console.log("soft offline cart rows:", softRows);

  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => null);
  await page.waitForTimeout(3000);
  const urlAfterReload = page.url();
  const addCount = await page.getByRole("button", { name: "Add to Cart" }).count();
  if (addCount > 0) {
    await page.getByRole("button", { name: "Add to Cart" }).first().click();
    await page.waitForTimeout(800);
  }
  const hardRows = await page.locator("section:has(h2:text-is('Cart')) table tbody tr").count();
  console.log(
    JSON.stringify({ urlAfterReload, addCountAfterHardReload: addCount, hardRows }, null, 2),
  );

  await browser.close();
  await admin.from("user_accounts").delete().eq("auth_uid", u!.user!.id);
  await admin.auth.admin.deleteUser(u!.user!.id);
}

main().catch(console.error);
