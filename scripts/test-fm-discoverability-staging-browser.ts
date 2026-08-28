/**
 * Browser QA: FM discoverability (portal chooser + landlord FM invite UI).
 *
 *   node scripts/_run-with-staging-env.mjs npx next dev -p 3000
 *   npx tsx scripts/test-fm-discoverability-staging-browser.ts
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const LANDLORD_EMAIL = "david.avors@unifaitechnologies.com";
const LANDLORD_PASSWORD =
  process.env.LANDLORD_TEST_PASSWORD?.trim() ?? "LandlordStagingTest!2026";
const FM_INVITE_EMAIL = "david.avors+fm-ui-qa@gmail.com";
const FM_INVITE_NAME = "FM UI QA";
const SCREENSHOT_DIR = resolve(process.cwd(), "scripts/_pilot-screenshots");

type Check = { scenario: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(scenario: string, pass: boolean, detail: string) {
  checks.push({ scenario, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${scenario}: ${detail}`);
}

async function fillReactInput(page: Page, selector: string, value: string) {
  const locator = page.locator(selector);
  await locator.waitFor({ state: "visible", timeout: 30000 });
  await locator.click();
  await locator.fill("");
  await locator.pressSequentially(value, { delay: 20 });
  const actual = await locator.inputValue();
  if (actual !== value) {
    // Fallback: set value via React-friendly native setter
    await locator.evaluate((el, v) => {
      const input = el as HTMLInputElement;
      const proto = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      );
      proto?.set?.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  }
}

async function loginLandlord(page: Page) {
  await page.goto(`${APP_URL}/landlord-portal/login`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await fillReactInput(page, "#email", LANDLORD_EMAIL);
  await fillReactInput(page, "#password", LANDLORD_PASSWORD);

  const emailValue = await page.locator("#email").inputValue();
  const passwordValue = await page.locator("#password").inputValue();
  if (emailValue !== LANDLORD_EMAIL || passwordValue !== LANDLORD_PASSWORD) {
    throw new Error(
      `Login fields not set. email="${emailValue}" passwordLen=${passwordValue.length}`,
    );
  }

  await page.getByRole("button", { name: /sign in/i }).click();

  try {
    await page.waitForURL(/\/landlord-portal\/(dashboard|login\/mfa)/, {
      timeout: 120000,
    });
  } catch (error) {
    const errText = await page
      .locator("p.text-red-700")
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(
      `Landlord login failed. url=${page.url()} error=${errText ?? "(none)"} original=${String(error)}`,
    );
  }
  if (page.url().includes("/mfa")) {
    throw new Error("Landlord MFA required");
  }
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii") || !serviceKey) {
    throw new Error("Staging Supabase credentials required");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Clean any prior QA invite for this plus-alias
  const { data: prior } = await admin
    .from("facility_managers")
    .select("facility_manager_id")
    .eq("email", FM_INVITE_EMAIL.toLowerCase());
  for (const row of prior ?? []) {
    const id = row.facility_manager_id as string;
    await admin
      .from("facility_manager_portal_invites")
      .delete()
      .eq("facility_manager_id", id);
    await admin
      .from("facility_manager_property_assignments")
      .delete()
      .eq("facility_manager_id", id);
    await admin.from("facility_managers").delete().eq("facility_manager_id", id);
  }

  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PW_CHANNEL ?? "msedge",
  });
  const page = await browser.newPage();

  let invitedFmId: string | null = null;

  try {
    await page.goto(`${APP_URL}/`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    const chooserPath = resolve(
      SCREENSHOT_DIR,
      "fm-discoverability-portal-chooser.png",
    );
    await page.screenshot({ path: chooserPath, fullPage: true });

    const hasLandlordCard = await page
      .getByRole("heading", { name: /I'm a Landlord/i })
      .isVisible();
    const hasTenantCard = await page
      .getByRole("heading", { name: /I'm a Tenant/i })
      .isVisible();
    const hasFmCard = await page
      .getByRole("heading", { name: /I'm a Facility Manager/i })
      .isVisible();
    record(
      "1. Portal chooser three cards",
      hasLandlordCard && hasTenantCard && hasFmCard,
      `Landlord=${hasLandlordCard} Tenant=${hasTenantCard} FM=${hasFmCard} screenshot=${chooserPath}`,
    );

    await loginLandlord(page);
    record("2. Landlord login", true, page.url());

    await page.goto(`${APP_URL}/landlord-portal/real-estate/facility-managers`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.getByRole("heading", { name: /Facility Managers/i }).waitFor({
      timeout: 60000,
    });
    record("3. FM list page loads", true, page.url());

    await page.getByRole("button", { name: /Invite Facility Manager/i }).click();
    await page.locator("#fm-invite-full-name").waitFor({ state: "visible" });
    await fillReactInput(page, "#fm-invite-full-name", FM_INVITE_NAME);
    await fillReactInput(page, "#fm-invite-email", FM_INVITE_EMAIL);

    const propertyCheckbox = page
      .getByRole("dialog")
      .locator('input[type="checkbox"]')
      .first();
    await propertyCheckbox.check();

    await page.getByRole("button", { name: /^Save$/i }).click();
    await page.getByText(/Invite sent to/i).waitFor({ timeout: 90000 });
    record("4. Invite FM via landlord UI", true, FM_INVITE_EMAIL);

    const fmListPath = resolve(
      SCREENSHOT_DIR,
      "fm-discoverability-landlord-fm-list.png",
    );
    await page.screenshot({ path: fmListPath, fullPage: true });

    const { data: fmRow } = await admin
      .from("facility_managers")
      .select("facility_manager_id, status, email")
      .eq("email", FM_INVITE_EMAIL.toLowerCase())
      .maybeSingle();

    invitedFmId = fmRow?.facility_manager_id ?? null;
    record(
      "5. DB facility_managers row",
      fmRow?.status === "invited" && Boolean(invitedFmId),
      fmRow ? `${fmRow.status} ${fmRow.email}` : "not found",
    );
  } finally {
    await browser.close();

    if (invitedFmId) {
      await admin
        .from("facility_manager_portal_invites")
        .delete()
        .eq("facility_manager_id", invitedFmId);
      await admin
        .from("facility_manager_property_assignments")
        .delete()
        .eq("facility_manager_id", invitedFmId);
      await admin
        .from("facility_managers")
        .delete()
        .eq("facility_manager_id", invitedFmId);
      console.log(`Cleaned up test FM ${invitedFmId}`);
    }
  }

  const failed = checks.filter((c) => !c.pass);
  console.log("\n--- Summary ---");
  for (const check of checks) {
    console.log(`${check.pass ? "PASS" : "FAIL"}: ${check.scenario}`);
  }
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
