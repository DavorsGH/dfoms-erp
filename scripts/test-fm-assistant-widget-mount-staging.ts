/**
 * Confirm Facility Manager portal mounts the assistant chat widget (no Anthropic needed).
 *
 *   APP_URL=http://localhost:3000 npx tsx scripts/test-fm-assistant-widget-mount-staging.ts
 */
import { chromium } from "playwright";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const FM_EMAIL = "david.avors+fm@gmail.com";
const FM_PASSWORD =
  process.env.FM_TEST_PASSWORD?.trim() ?? "FmStagingTest!2026";

async function fillReactInput(page: import("playwright").Page, selector: string, value: string) {
  const locator = page.locator(selector);
  await locator.waitFor({ state: "visible", timeout: 30000 });
  await locator.click();
  await locator.fill("");
  await locator.pressSequentially(value, { delay: 15 });
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii") || !serviceKey) {
    throw new Error("Staging credentials required");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: fm } = await admin
    .from("facility_managers")
    .select("auth_user_id")
    .eq("email", FM_EMAIL.toLowerCase())
    .eq("status", "active")
    .maybeSingle();
  if (!fm?.auth_user_id) {
    throw new Error("Active FM auth_user_id missing");
  }
  await admin.auth.admin.updateUserById(fm.auth_user_id as string, {
    password: FM_PASSWORD,
    email_confirm: true,
  });

  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PW_CHANNEL ?? "msedge",
  });
  const page = await browser.newPage();
  try {
    await page.goto(`${APP_URL}/facility-portal/login`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await fillReactInput(page, "#email", FM_EMAIL);
    await fillReactInput(page, "#password", FM_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/facility-portal\/(dashboard|login\/mfa)/, {
      timeout: 120000,
    });
    if (page.url().includes("/mfa")) {
      throw new Error("FM MFA required");
    }

    const launcher = page.getByRole("button", {
      name: /Open Ask DAVORS-ERP/i,
    });
    await launcher.waitFor({ state: "visible", timeout: 30000 });
    console.log("PASS: FM portal assistant launcher visible at", page.url());
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
