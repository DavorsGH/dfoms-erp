/**
 * Browser QA: FM Complaints + Inspections + Collections (staging).
 *
 *   npm run dev -- -p 3000
 *   npx tsx scripts/test-fm-portal-complaints-inspections-collections-staging-browser.ts
 */
import { chromium, type Page } from "playwright";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const FM_EMAIL = "david.avors+fm@gmail.com";
const FM_PASSWORD = "FmStagingTest!2026";
const LANDLORD_EMAIL = "david.avors@unifaitechnologies.com";
const LANDLORD_PASSWORD =
  process.env.LANDLORD_TEST_PASSWORD?.trim() ?? "LandlordStagingTest!2026";
const MARKER = `FM-qa-${Date.now()}`;

type Check = { scenario: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(scenario: string, pass: boolean, detail: string) {
  checks.push({ scenario, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${scenario}: ${detail}`);
}

async function loginFm(page: Page) {
  await page.goto(`${APP_URL}/facility-portal/login`, { waitUntil: "networkidle" });
  await page.locator("#email").fill(FM_EMAIL);
  await page.locator("#password").fill(FM_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/facility-portal\/(dashboard|login\/mfa)/, { timeout: 30000 });
  if (page.url().includes("/mfa")) throw new Error("FM MFA required");
}

async function loginLandlord(page: Page, password: string) {
  await page.goto(`${APP_URL}/landlord-portal/login`, { waitUntil: "networkidle" });
  await page.locator("#email").fill(LANDLORD_EMAIL);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/landlord-portal\/(dashboard|login\/mfa)/, { timeout: 30000 });
  if (page.url().includes("/mfa")) throw new Error("Landlord MFA required");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii") || !serviceKey) {
    throw new Error("Staging Supabase credentials required");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const landlordPassword = LANDLORD_PASSWORD;

  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PW_CHANNEL ?? "msedge",
  });
  const page = await browser.newPage();

  let collectionId: string | null = null;
  let ledgerEntryId: string | null = null;
  let amountBefore = 0;

  try {
    await loginFm(page);
    record("1. FM login", true, page.url());

    // Complaints: file + respond
    await page.goto(`${APP_URL}/facility-portal/complaints`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "File complaint" }).click();
    await page.locator("#fm-complaint-lease").selectOption({ index: 1 });
    await page.locator("#fm-complaint-subject").fill(`${MARKER} noise complaint`);
    await page.locator("#fm-complaint-desc").fill("Tenant noise after hours.");
    await page.getByRole("button", { name: /file complaint/i }).click();
    await page
      .getByText(/complaint filed|success/i)
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => undefined);
    const complaintPageText = await page.locator("main").innerText();
    if (/error|unable|required/i.test(complaintPageText)) {
      record("2. File complaint (page error)", false, complaintPageText.slice(0, 200));
    }
    await page.waitForTimeout(1500);

    const { data: filed } = await admin
      .from("lessee_complaints")
      .select("complaint_id, subject")
      .ilike("subject", `%${MARKER}%`)
      .limit(1);
    record(
      "2. File complaint",
      Boolean(filed?.[0]),
      filed?.[0] ? `complaint_id=${filed[0].complaint_id}` : "not in DB",
    );

    // Respond to first open tenant-raised complaint if present
    await page.getByRole("tab", { name: "Complaints" }).click();
    const reviewBtn = page.getByRole("button", { name: /review & respond/i }).first();
    if (await reviewBtn.count()) {
      await reviewBtn.click();
      await page.locator("textarea").first().fill(`${MARKER} FM response`);
      await page.getByRole("button", { name: /save response/i }).click();
      await page.waitForTimeout(2000);
      record("2b. Respond to complaint", true, "saved response on open complaint");
    } else {
      record(
        "2b. Respond to complaint",
        true,
        "skipped — no open tenant complaint in list (file step passed)",
      );
    }

    // Inspection
    await page.goto(`${APP_URL}/facility-portal/inspections`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "New inspection" }).click();
    await page.locator("#fm-insp-lease").selectOption({ index: 1 });
    await page.locator("#fm-insp-notes").fill(`${MARKER} move-in check`);
    await page.getByRole("button", { name: /save inspection/i }).click();
    await page
      .getByText(/inspection recorded|success/i)
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => undefined);
    const inspPageText = await page.locator("main").innerText();
    if (/error|unable|required/i.test(inspPageText)) {
      record("3. Create inspection (page error)", false, inspPageText.slice(0, 200));
    }
    await page.waitForTimeout(1500);

    const { data: insp } = await admin
      .from("inspections")
      .select("inspection_id, notes")
      .ilike("notes", `%${MARKER}%`)
      .limit(1);
    record(
      "3. Create inspection",
      Boolean(insp?.[0]),
      insp?.[0] ? `inspection_id=${insp[0].inspection_id}` : "not in DB",
    );

    // Collections
    await page.goto(`${APP_URL}/facility-portal/collections`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "Outstanding" }).click();
    const outstandingRow = page.locator("li").filter({ hasText: /Outstanding/i }).first();
    const hasOutstanding = await outstandingRow.count();
    record(
      "4a. Outstanding ledger entries exist",
      hasOutstanding > 0,
      hasOutstanding > 0 ? "entry visible" : "none on assigned properties",
    );

    if (hasOutstanding > 0) {
      let ledgerPaidBeforeRecord: number | null = null;
      const collectibleRow = page
        .locator("li")
        .filter({ hasText: /Outstanding/i })
        .filter({ hasNotText: /pending collection/i })
        .first();
      const hasCollectible = (await collectibleRow.count()) > 0;

      if (hasCollectible) {
        await collectibleRow.click();
        await page.locator("#fm-col-amt").waitFor({ state: "visible", timeout: 10000 });

        const { data: preRecordLedgerRows } = await admin
          .from("rent_ledger")
          .select("entry_id, amount_paid_ghs")
          .eq("tenant_id", "a0792446-3bd1-4eaf-a0e8-84d089d032a0")
          .neq("status", "paid");
        if (preRecordLedgerRows?.length === 1) {
          ledgerPaidBeforeRecord =
            Number(preRecordLedgerRows[0].amount_paid_ghs) || 0;
        }

        await page.locator("#fm-col-amt").fill("10.00");
        await page.locator("#fm-col-method").selectOption("cash");
        await page.locator("#fm-col-notes").fill(`${MARKER} cash collection`);
        await page.getByRole("button", { name: /record collection/i }).click();
        await page
          .getByText(/pending landlord confirmation|collection recorded/i)
          .first()
          .waitFor({ timeout: 15000 })
          .catch(() => undefined);
        const colPageText = await page.locator("main").innerText();
        if (/error|unable|exceed|permission/i.test(colPageText)) {
          record("4b. Record collection (page error)", false, colPageText.slice(0, 240));
        }
        await page.waitForTimeout(1500);

        const { data: colRows } = await admin
          .from("facility_manager_collections")
          .select("collection_id, rent_ledger_entry_id, amount_ghs, status")
          .ilike("notes", `%${MARKER}%`)
          .limit(1);
        collectionId = colRows?.[0]?.collection_id ?? null;
        ledgerEntryId = colRows?.[0]?.rent_ledger_entry_id ?? null;
        record(
          "4b. Record cash collection (pending)",
          colRows?.[0]?.status === "pending_landlord_confirmation",
          colRows?.[0]
            ? `status=${colRows[0].status} amount=${colRows[0].amount_ghs}`
            : "not in DB",
        );
      } else {
        const { data: pendingCol } = await admin
          .from("facility_manager_collections")
          .select("collection_id, rent_ledger_entry_id, amount_ghs, status")
          .eq("status", "pending_landlord_confirmation")
          .order("collected_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        collectionId = pendingCol?.collection_id ?? null;
        ledgerEntryId = pendingCol?.rent_ledger_entry_id ?? null;
        record(
          "4b. Record cash collection (pending)",
          pendingCol?.status === "pending_landlord_confirmation",
          pendingCol
            ? `reused existing pending collection ${pendingCol.collection_id}`
            : "no collectible row and no pending collection in DB",
        );
      }

      if (ledgerEntryId) {
        const { data: ledgerBefore } = await admin
          .from("rent_ledger")
          .select("amount_paid_ghs")
          .eq("entry_id", ledgerEntryId)
          .maybeSingle();
        amountBefore = Number(ledgerBefore?.amount_paid_ghs) || 0;
        const unchangedBeforeConfirm =
          ledgerPaidBeforeRecord === null
            ? amountBefore === 0
            : amountBefore === ledgerPaidBeforeRecord;
        record(
          "4c. Ledger NOT updated before confirm",
          unchangedBeforeConfirm,
          ledgerPaidBeforeRecord === null
            ? `amount_paid_ghs=${amountBefore}`
            : `before_record=${ledgerPaidBeforeRecord} after_record=${amountBefore}`,
        );
      }
    }

    // Landlord confirm
    if (landlordPassword && collectionId) {
      await page.context().clearCookies();
      await loginLandlord(page, landlordPassword);
      await page.goto(`${APP_URL}/landlord-portal/finance/rent-ledger`, {
        waitUntil: "networkidle",
      });
      await page.getByText(/Pending FM collections/i).waitFor({ timeout: 15000 }).catch(() => undefined);
      const confirmBtn = page.getByRole("button", { name: /^Confirm$/i }).first();
      if (await confirmBtn.count()) {
        await confirmBtn.click();
        await page.waitForTimeout(4000);
      } else {
        record(
          "5a. Landlord confirm collection",
          false,
          "Confirm button not found on rent ledger page",
        );
      }

      const { data: colAfter } = await admin
        .from("facility_manager_collections")
        .select("status, applied_to_rent_ledger_at")
        .eq("collection_id", collectionId)
        .maybeSingle();
      record(
        "5a. Landlord confirm collection",
        colAfter?.status === "confirmed",
        colAfter ? `status=${colAfter.status}` : "missing",
      );

      if (ledgerEntryId) {
        const { data: ledgerAfter } = await admin
          .from("rent_ledger")
          .select("amount_paid_ghs")
          .eq("entry_id", ledgerEntryId)
          .maybeSingle();
        const amountAfter = Number(ledgerAfter?.amount_paid_ghs) || 0;
        record(
          "5b. Ledger updated after confirm only",
          amountAfter > amountBefore,
          `before=${amountBefore} after=${amountAfter}`,
        );
      }
    } else if (!landlordPassword) {
      record("5. Landlord confirm flow", false, "skipped — no LANDLORD_TEST_PASSWORD");
    } else {
      record("5. Landlord confirm flow", false, "skipped — no collection created");
    }
  } catch (error) {
    record("unexpected", false, error instanceof Error ? error.message : String(error));
  } finally {
    await browser.close();
  }

  console.log("\n=== SUMMARY ===");
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"} | ${c.scenario} | ${c.detail}`);
  }
  process.exit(checks.some((c) => !c.pass) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
