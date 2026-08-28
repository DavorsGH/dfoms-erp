/**
 * Browser QA: Facility Manager portal Maintenance + Services + nav gating.
 * Local next (uncommitted) + staging Supabase.
 *
 *   npm run dev -- -p 3000
 *   npx tsx scripts/test-fm-portal-maintenance-services-staging-browser.ts
 *
 * APP_URL default http://localhost:3000
 */
import { chromium, type Page } from "playwright";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const FM_EMAIL = "david.avors+fm@gmail.com";
const FM_PASSWORD = "FmStagingTest!2026";
const FM_ID = "3b08b635-40f9-41cc-bbd5-02ef81ccb67b";
const MARKER = `FM-browser-qa-${Date.now()}`;

type Check = { scenario: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(scenario: string, pass: boolean, detail: string) {
  checks.push({ scenario, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${scenario}: ${detail}`);
}

async function loginFm(page: Page) {
  await page.goto(`${APP_URL}/facility-portal/login`, {
    waitUntil: "networkidle",
  });
  await page.locator("#email").waitFor({ state: "visible" });
  await page.locator("#email").fill(FM_EMAIL);
  await page.locator("#password").fill(FM_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/facility-portal\/(dashboard|login\/mfa)/, {
    timeout: 30000,
  });
  if (page.url().includes("/mfa")) {
    throw new Error("MFA required for FM test account — clear MFA before QA");
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url.includes(STAGING_REF) || !serviceKey) {
    throw new Error("Staging Supabase credentials required");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Ensure capabilities ON for first half of nav test
  await admin
    .from("facility_managers")
    .update({
      can_manage_complaints: true,
      can_manage_inspections: true,
      can_collect_rent: true,
      can_collect_charges: true,
      can_manage_maintenance: true,
      can_log_services: true,
    })
    .eq("facility_manager_id", FM_ID);

  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PW_CHANNEL ?? "msedge",
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Login
    try {
      await loginFm(page);
      const onDash = page.url().includes("/facility-portal/dashboard");
      record(
        "1. Login as FM test account",
        onDash,
        onDash ? `landed ${page.url()}` : `unexpected ${page.url()}`,
      );
    } catch (error) {
      record(
        "1. Login as FM test account",
        false,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    // Nav when capabilities ON
    const navOn = await page.locator("aside nav a").allTextContents();
    const navOnJoined = navOn.map((t) => t.trim()).filter(Boolean).join(" | ");
    const placeholdersVisible =
      navOnJoined.includes("Complaints") &&
      navOnJoined.includes("Inspections") &&
      navOnJoined.includes("Collections");
    record(
      "2a. Nav shows Complaints/Inspections/Collections when capabilities ON",
      placeholdersVisible,
      navOnJoined || "(empty nav)",
    );

    // 2. Create maintenance
    let createdRequestId: string | null = null;
    try {
      await page.goto(`${APP_URL}/facility-portal/maintenance`, {
        waitUntil: "networkidle",
      });
      await page.getByRole("tab", { name: "New request" }).click();
      await page.locator("#fm-desc").waitFor({ state: "visible", timeout: 10000 });
      const leaseSelect = page.locator("#fm-lease");
      const leaseOptionCount = await leaseSelect.locator("option").count();
      if (leaseOptionCount < 2) {
        throw new Error(
          "No active leases on assigned properties — cannot create maintenance",
        );
      }
      await leaseSelect.selectOption({ index: 1 });
      await page.locator("#fm-desc").fill(`${MARKER} leak under sink`);
      await page.getByRole("button", { name: /submit request/i }).click();
      await page
        .getByText(/request submitted|created|success/i)
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => undefined);
      await page.waitForTimeout(1500);

      const { data: rows } = await admin
        .from("maintenance_requests")
        .select("request_id, reported_by, description")
        .ilike("description", `%${MARKER}%`)
        .order("date_reported", { ascending: false })
        .limit(1);

      createdRequestId = (rows?.[0]?.request_id as string) ?? null;
      const reportedBy = rows?.[0]?.reported_by as string | undefined;
      record(
        "2b. Create maintenance request",
        Boolean(createdRequestId),
        createdRequestId
          ? `request_id=${createdRequestId}`
          : "no matching row in DB",
      );
      record(
        "2c. reported_by is facility_manager",
        reportedBy === "facility_manager",
        `reported_by=${reportedBy ?? "(missing)"}`,
      );

      // List UI
      await page.goto(`${APP_URL}/facility-portal/maintenance`, {
        waitUntil: "networkidle",
      });
      const listText = await page.locator("main").innerText();
      const showsDesc = listText.includes(MARKER);
      const showsReporter = /Facility Manager/i.test(listText);
      record(
        "2d. List shows new request with Facility Manager reporter",
        showsDesc && showsReporter,
        showsDesc
          ? showsReporter
            ? "description + Facility Manager label present"
            : "description present but Facility Manager label missing"
          : "description not in list",
      );
    } catch (error) {
      record(
        "2b. Create maintenance request",
        false,
        error instanceof Error ? error.message : String(error),
      );
      record("2c. reported_by is facility_manager", false, "skipped");
      record(
        "2d. List shows new request with Facility Manager reporter",
        false,
        "skipped",
      );
    }

    // 3. Log service with cost
    try {
      await page.goto(`${APP_URL}/facility-portal/services`, {
        waitUntil: "networkidle",
      });
      const beforeText = await page.locator("main").innerText();
      const beforeMatch = beforeText.match(/Running cost total[\s\S]*?GHS\s*([\d,]+\.?\d*)/i);
      const beforeTotal = beforeMatch
        ? Number(beforeMatch[1].replace(/,/g, ""))
        : 0;

      await page.getByRole("tab", { name: "Log service" }).click();
      const propertySelect = page.locator("#svc-property");
      await propertySelect.waitFor({ state: "visible", timeout: 10000 });
      const propOptions = await propertySelect.locator("option").count();
      if (propOptions < 2) {
        throw new Error("No assigned properties for service logging");
      }
      await propertySelect.selectOption({ index: 1 });

      const typeSelect = page.locator("#svc-type");
      if (await typeSelect.count()) {
        await typeSelect.selectOption("gardening");
      }

      const notes = page.locator("#svc-notes");
      if (await notes.count()) {
        await notes.fill(`${MARKER} gardening`);
      } else {
        await page.locator("textarea").first().fill(`${MARKER} gardening`);
      }

      const costInput = page.locator("#svc-cost");
      if (await costInput.count()) {
        await costInput.fill("42.50");
      } else {
        await page.locator('input[type="number"]').first().fill("42.50");
      }

      await page.getByRole("button", { name: /log service|save|submit/i }).click();
      await page
        .getByText(/service logged|success/i)
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => undefined);
      await page.waitForTimeout(1500);
      await page.goto(`${APP_URL}/facility-portal/services`, {
        waitUntil: "networkidle",
      });

      const afterText = await page.locator("main").innerText();
      const afterMatch = afterText.match(
        /Running cost total[\s\S]*?GHS\s*([\d,]+\.?\d*)/i,
      );
      const afterTotal = afterMatch
        ? Number(afterMatch[1].replace(/,/g, ""))
        : NaN;

      const { data: svcRows, error: svcErr } = await admin
        .from("property_service_records")
        .select("record_id, cost_ghs, notes, service_type")
        .eq("logged_by_facility_manager_id", FM_ID)
        .eq("cost_ghs", 42.5)
        .order("service_date", { ascending: false })
        .limit(5);

      const matched = (svcRows ?? []).find((row) =>
        String(row.notes ?? "").includes(MARKER),
      );
      const svcOk = Boolean(matched) || (svcRows?.length ?? 0) > 0;
      const costOk =
        Number(matched?.cost_ghs ?? svcRows?.[0]?.cost_ghs) === 42.5;
      record(
        "3a. Log service with cost 42.50",
        svcOk && costOk,
        svcOk
          ? `cost_ghs=${matched?.cost_ghs ?? svcRows?.[0]?.cost_ghs}; notesMatch=${Boolean(matched)}; err=${svcErr?.message ?? "none"}`
          : `no matching service row; err=${svcErr?.message ?? "none"}`,
      );

      const totalIncreased =
        Number.isFinite(afterTotal) && afterTotal >= beforeTotal + 42.5 - 0.01;
      record(
        "3b. Running cost total updates",
        totalIncreased,
        `before≈${beforeTotal} after≈${afterTotal}`,
      );
    } catch (error) {
      record(
        "3a. Log service with cost 42.50",
        false,
        error instanceof Error ? error.message : String(error),
      );
      record("3b. Running cost total updates", false, "skipped");
    }

    // 4. Capability gating OFF
    await admin
      .from("facility_managers")
      .update({
        can_manage_complaints: false,
        can_manage_inspections: false,
        can_collect_rent: false,
        can_collect_charges: false,
      })
      .eq("facility_manager_id", FM_ID);

    await page.goto(`${APP_URL}/facility-portal/dashboard`, {
      waitUntil: "networkidle",
    });
    const navOff = (await page.locator("aside nav a").allTextContents())
      .map((t) => t.trim())
      .filter(Boolean);
    const navOffJoined = navOff.join(" | ");
    const hidden =
      !navOffJoined.includes("Complaints") &&
      !navOffJoined.includes("Inspections") &&
      !navOffJoined.includes("Collections");
    const stillOps =
      navOffJoined.includes("Maintenance") &&
      navOffJoined.includes("Services");
    record(
      "4. Nav hides Complaints/Inspections/Collections when capabilities OFF",
      hidden && stillOps,
      navOffJoined || "(empty)",
    );
  } finally {
    // Restore capabilities
    await admin
      .from("facility_managers")
      .update({
        can_manage_complaints: true,
        can_manage_inspections: true,
        can_collect_rent: true,
        can_collect_charges: true,
      })
      .eq("facility_manager_id", FM_ID);

    await browser.close();
  }

  console.log("\n=== SUMMARY ===");
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"} | ${c.scenario} | ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
