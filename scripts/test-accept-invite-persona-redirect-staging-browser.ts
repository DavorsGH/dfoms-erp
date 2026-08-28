/**
 * Browser QA: accept-invite must stay reachable when another persona is signed in,
 * and wrong-portal home redirects must not carry ?token=.
 *
 *   node scripts/_run-with-staging-env.mjs npx next start -p 3014
 *   (or next dev) then:
 *   npx tsx scripts/test-accept-invite-persona-redirect-staging-browser.ts
 *
 * Optional: APP_URL=http://localhost:3014
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const APP_URL = (process.env.APP_URL ?? "http://localhost:3014").replace(
  /\/$/,
  "",
);
const LANDLORD_EMAIL = "david.avors@unifaitechnologies.com";
const LANDLORD_PASSWORD =
  process.env.LANDLORD_TEST_PASSWORD?.trim() ?? "LandlordStagingTest!2026";
const SCREENSHOT_DIR = resolve(process.cwd(), "scripts/_pilot-screenshots");

type Check = { scenario: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(scenario: string, pass: boolean, detail: string) {
  checks.push({ scenario, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${scenario}: ${detail}`);
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function fillReactInput(page: Page, selector: string, value: string) {
  const locator = page.locator(selector);
  await locator.waitFor({ state: "visible", timeout: 30000 });
  await locator.click();
  await locator.fill("");
  await locator.pressSequentially(value, { delay: 15 });
}

async function loginLandlord(page: Page) {
  await page.goto(`${APP_URL}/landlord-portal/login`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await fillReactInput(page, "#email", LANDLORD_EMAIL);
  await fillReactInput(page, "#password", LANDLORD_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/landlord-portal\/(dashboard|login\/mfa)/, {
    timeout: 120000,
  });
  if (page.url().includes("/mfa")) {
    throw new Error("Landlord MFA required");
  }
}

async function createFmInviteToken(admin: ReturnType<typeof createClient>) {
  const stamp = Date.now().toString(36);
  const email = `fm.redirect.qa.${stamp}@davors-staging-test.invalid`;

  const { data: landlords, error: landlordError } = await admin
    .from("landlords")
    .select("tenant_id")
    .eq("approval_status", "approved")
    .limit(20);
  if (landlordError) throw new Error(landlordError.message);

  let tenantId: string | null = null;
  let propertyId: string | null = null;
  for (const row of landlords ?? []) {
    const { data: props } = await admin
      .from("properties")
      .select("property_id")
      .eq("tenant_id", row.tenant_id)
      .limit(1);
    if (props?.[0]?.property_id) {
      tenantId = row.tenant_id;
      propertyId = props[0].property_id;
      break;
    }
  }
  if (!tenantId || !propertyId) {
    throw new Error("No approved landlord with a property on staging");
  }

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 7);

  const { data: fm, error: fmError } = await admin
    .from("facility_managers")
    .insert({
      tenant_id: tenantId,
      full_name: `FM Redirect QA ${stamp}`,
      email,
      status: "invited",
      can_manage_maintenance: true,
      can_manage_complaints: true,
      can_manage_inspections: true,
      can_log_services: true,
      can_collect_rent: false,
      can_collect_charges: false,
      invited_at: now.toISOString(),
    })
    .select("facility_manager_id")
    .single();
  if (fmError || !fm) throw new Error(fmError?.message ?? "FM insert failed");

  await admin.from("facility_manager_property_assignments").insert({
    tenant_id: tenantId,
    facility_manager_id: fm.facility_manager_id,
    property_id: propertyId,
  });

  const rawToken = randomBytes(32).toString("hex");
  const { error: inviteError } = await admin
    .from("facility_manager_portal_invites")
    .insert({
      tenant_id: tenantId,
      facility_manager_id: fm.facility_manager_id,
      email,
      token_hash: hashToken(rawToken),
      expires_at: expiresAt.toISOString(),
    });
  if (inviteError) throw new Error(inviteError.message);

  return {
    rawToken,
    email,
    facilityManagerId: fm.facility_manager_id as string,
    tenantId,
  };
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii") || !serviceKey) {
    throw new Error("Staging Supabase credentials required");
  }
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const invite = await createFmInviteToken(admin);
  console.log("Created FM invite for", invite.email);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await loginLandlord(page);
    record(
      "landlord-session",
      page.url().includes("/landlord-portal/dashboard"),
      page.url(),
    );

    const acceptPath = `/facility-portal/accept-invite?token=${encodeURIComponent(invite.rawToken)}`;
    await page.goto(`${APP_URL}${acceptPath}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2500);

    const afterAccept = page.url();
    const stayedOnAccept =
      afterAccept.includes("/facility-portal/accept-invite") &&
      afterAccept.includes(`token=${invite.rawToken}`);
    const bouncedWithToken =
      afterAccept.includes("/landlord-portal/dashboard") &&
      afterAccept.includes("token=");
    record(
      "fm-accept-while-landlord-logged-in",
      stayedOnAccept && !bouncedWithToken,
      afterAccept,
    );

    await page.screenshot({
      path: resolve(SCREENSHOT_DIR, "accept-invite-fm-while-landlord.png"),
      fullPage: true,
    });

    const heading = await page
      .getByRole("heading", { name: /accept facility manager invite/i })
      .isVisible()
      .catch(() => false);
    record(
      "fm-accept-heading-visible",
      heading,
      heading ? "heading visible" : "heading missing",
    );

    // Wrong-portal non-accept link: token must not travel to landlord home.
    await page.goto(
      `${APP_URL}/facility-portal/dashboard?token=${encodeURIComponent(invite.rawToken)}`,
      { waitUntil: "domcontentloaded", timeout: 60000 },
    );
    await page.waitForTimeout(2000);
    const afterDash = page.url();
    const cleanHome =
      afterDash.includes("/landlord-portal/dashboard") &&
      !afterDash.includes("token=");
    record("wrong-portal-redirect-strips-token", cleanHome, afterDash);

    await page.screenshot({
      path: resolve(SCREENSHOT_DIR, "accept-invite-token-stripped-home.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
    // Cleanup unused invite FM row
    await admin
      .from("facility_managers")
      .delete()
      .eq("facility_manager_id", invite.facilityManagerId);
  }

  const failed = checks.filter((c) => !c.pass);
  console.log("\n--- Summary ---");
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"} | ${c.scenario} | ${c.detail}`);
  }
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${checks.length} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
