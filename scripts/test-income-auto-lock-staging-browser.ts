/**
 * Browser QA: Income Register auto-posted Edit/Delete lockdown.
 * Uses LOCAL next (uncommitted code) + staging Supabase data.
 *
 *   # terminal 1 â€” staging env, local app:
 *   copy .env.staging.local to drive next (or):
 *   npx next dev -p 3011
 *   (ensure .env.local points at staging OR symlink env)
 *
 *   # terminal 2:
 *   npx tsx scripts/test-income-auto-lock-staging-browser.ts
 *
 * Requires APP_URL default http://localhost:3011
 */
import { chromium, type Page, type Locator } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { loadEnvForce } from "./lib/env";
import { connectPg } from "./lib/pg-connect";
import { detectAutoPostedIncomeRegisterEntry } from "../app/dashboard/finance/register-auto-posted-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const APP_URL = (process.env.APP_URL ?? "http://localhost:3011").replace(
  /\/$/,
  "",
);

type Check = { scenario: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(scenario: string, pass: boolean, detail: string) {
  checks.push({ scenario, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${scenario}: ${detail}`);
}

async function createProbeUser(url: string, serviceKey: string) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  const email = `income-lock.${stamp}@test.davors`;
  const password = `IncomeLock-${stamp}!Aa8`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (error || !data.user) throw new Error(error?.message ?? "createUser failed");
  const authUid = data.user.id;
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
  return { email, password, authUid };
}

async function deleteProbeUser(url: string, serviceKey: string, authUid: string) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await admin.from("user_accounts").delete().eq("auth_uid", authUid);
  await admin.auth.admin.deleteUser(authUid);
}


async function login(page: Page, email: string, password: string) {
  await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle" });
  await page.locator("#email").waitFor({ state: "visible" });
  // Controlled React inputs: type after hydration so onChange fires.
  await page.locator("#email").click();
  await page.locator("#email").fill("");
  await page.locator("#email").pressSequentially(email, { delay: 15 });
  await page.locator("#password").click();
  await page.locator("#password").fill("");
  await page.locator("#password").pressSequentially(password, { delay: 15 });
  const emailVal = await page.locator("#email").inputValue();
  const passVal = await page.locator("#password").inputValue();
  if (emailVal !== email || passVal !== password) {
    throw new Error(`login fields not set (emailLen=${emailVal.length} passLen=${passVal.length})`);
  }
  await page.getByRole("button", { name: /^Sign In$/i }).click();
  const err = page.locator("p.text-red-600");
  await Promise.race([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
    err.waitFor({ state: "visible", timeout: 60_000 }).then(async () => {
      throw new Error(`login failed: ${((await err.textContent()) ?? "").trim()}`);
    }),
  ]);
}
async function findRowByInvoice(page: Page, invoiceNo: string): Promise<Locator> {
  const row = page.locator("tr", { hasText: invoiceNo }).first();
  await row.waitFor({ state: "visible", timeout: 30_000 });
  return row;
}

async function assertLockedRow(
  page: Page,
  scenario: string,
  invoiceNo: string,
  expectedSnippet: string,
) {
  const row = await findRowByInvoice(page, invoiceNo);
  const editBtn = row.getByRole("button", { name: /^Edit$/ });
  const deleteBtn = row.getByRole("button", { name: /^Delete$/ });

  const editDisabled = await editBtn.isDisabled();
  const deleteDisabled = await deleteBtn.isDisabled();
  const editTitle = (await editBtn.getAttribute("title")) ?? "";
  const deleteTitle = (await deleteBtn.getAttribute("title")) ?? "";
  const autoLabel = await row.locator("text=(auto-posted)").count();

  if (!editDisabled || !deleteDisabled) {
    record(
      scenario,
      false,
      `buttons not disabled (editDisabled=${editDisabled}, deleteDisabled=${deleteDisabled}) for ${invoiceNo}`,
    );
    return;
  }
  if (!editTitle.includes(expectedSnippet) && !editTitle.toLowerCase().includes(expectedSnippet.toLowerCase())) {
    record(
      scenario,
      false,
      `Edit title missing snippet "${expectedSnippet}". got: "${editTitle}"`,
    );
    return;
  }
  if (!deleteTitle.includes(expectedSnippet) && !deleteTitle.toLowerCase().includes(expectedSnippet.toLowerCase())) {
    record(
      scenario,
      false,
      `Delete title missing snippet "${expectedSnippet}". got: "${deleteTitle}"`,
    );
    return;
  }
  if (autoLabel < 1) {
    record(scenario, false, `missing (auto-posted) label for ${invoiceNo}`);
    return;
  }

  // Click must not open the edit form
  await editBtn.evaluate((el: HTMLElement) => el.scrollIntoView({ block: "nearest", inline: "nearest" }));
  await editBtn.click({ force: true });
  await page.waitForTimeout(500);
  const formOpen = await page.locator("form").filter({ hasText: /Save|Update/i }).count();
  // Also check error banner appeared (handler path) OR form still closed
  const errorBanner = page.locator("text=/cannot be edited|Synced from a Client Invoice|Auto-posted from Platform|System non-cash|Payroll auto-posted/i");
  const errorVisible = (await errorBanner.count()) > 0;

  // Delete click should not remove the row
  const beforeCount = await page.locator("tr", { hasText: invoiceNo }).count();
  await deleteBtn.click({ force: true });
  await page.waitForTimeout(500);
  const afterCount = await page.locator("tr", { hasText: invoiceNo }).count();

  if (formOpen > 0 && !errorVisible) {
    // Form might already be open from Add Entry â€” check if it's editing THIS invoice
    const invoiceField = page.locator('input[name="invoice_no"], input[value="' + invoiceNo + '"]');
    const editingThis =
      (await invoiceField.count()) > 0 &&
      ((await invoiceField.first().inputValue().catch(() => "")) === invoiceNo);
    if (editingThis) {
      record(scenario, false, `Edit click opened form for ${invoiceNo}`);
      return;
    }
  }
  if (afterCount < beforeCount) {
    record(scenario, false, `Delete click removed row ${invoiceNo}`);
    return;
  }

  record(
    scenario,
    true,
    `${invoiceNo}: Edit/Delete disabled; titles OK; click did not edit/delete. editTitle="${editTitle.slice(0, 80)}â€¦"`,
  );
}

async function assertManualRow(page: Page, invoiceNo: string) {
  const row = await findRowByInvoice(page, invoiceNo);
  const editBtn = row.getByRole("button", { name: /^Edit$/ });
  const deleteBtn = row.getByRole("button", { name: /^Delete$/ });

  const editDisabled = await editBtn.isDisabled();
  const deleteDisabled = await deleteBtn.isDisabled();
  if (editDisabled || deleteDisabled) {
    record(
      "manual",
      false,
      `${invoiceNo}: expected enabled Edit/Delete, got editDisabled=${editDisabled} deleteDisabled=${deleteDisabled}`,
    );
    return;
  }

  await editBtn.evaluate((el: HTMLButtonElement) => { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); el.click(); });
  const editHeading = page.getByRole("heading", { name: /Edit Income Entry/i });
  try {
    await editHeading.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    const errText = ((await page.locator("p.text-red-700, p.text-red-600").first().textContent().catch(() => null)) ?? "").trim();
    record(
      "manual",
      false,
      `${invoiceNo}: Edit click did not show Edit Income Entry form${errText ? ` (err=${errText})` : ""}`,
    );
    return;
  }

  const cancel = page.getByRole("button", { name: /^Cancel$/ });
  if ((await cancel.count()) > 0) {
    await cancel.first().click();
  }

  record(
    "manual",
    true,
    `${invoiceNo}: Edit/Delete enabled; Edit opened form`,
  );
}

async function loadScenarioRows() {
  const { client } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });
  try {
    const { rows } = await client.query<{
      scenario: string;
      invoice_no: string;
      id: string;
      service_category: string | null;
      entry_type: string | null;
      is_system_adjustment: boolean;
      linked: boolean;
    }>(`
      WITH ranked AS (
        SELECT
          ir.id::text,
          ir.invoice_no,
          ir.service_category,
          ir.entry_type::text AS entry_type,
          ir.is_system_adjustment,
          (ir.client_invoice_id IS NOT NULL) AS linked,
          CASE
            WHEN ir.is_system_adjustment IS TRUE
              OR ir.invoice_no ILIKE 'PAYROLL-DEDSAV-%' THEN 'system_adjustment'
            WHEN ir.client_invoice_id IS NOT NULL
              OR ir.service_category = 'Client Invoice' THEN 'client_invoice'
            WHEN ir.service_category IN ('Platform Billing', 'ERP Suite')
              OR ir.invoice_no ILIKE 'PSK-INC-%' THEN 'platform_billing'
            WHEN COALESCE(ir.is_system_adjustment, false) = false
              AND ir.client_invoice_id IS NULL
              AND COALESCE(ir.service_category, '') NOT IN (
                'Client Invoice', 'Platform Billing', 'ERP Suite',
                'Real Estate Management Fee'
              )
              AND COALESCE(ir.entry_type::text, '') IS DISTINCT FROM 'product_sale'
              AND COALESCE(ir.invoice_no, '') NOT ILIKE 'PSK-INC-%'
              AND COALESCE(ir.invoice_no, '') NOT ILIKE 'RE-MGMT-FEE-%'
              AND COALESCE(ir.invoice_no, '') NOT ILIKE 'PAYROLL-%'
              THEN 'manual'
            ELSE 'other'
          END AS scenario
        FROM public.income_register ir
        WHERE ir.tenant_id = $1::uuid
      )
      SELECT DISTINCT ON (scenario)
        scenario, id, invoice_no, service_category, entry_type,
        is_system_adjustment, linked
      FROM ranked
      WHERE scenario IN ('client_invoice', 'platform_billing', 'system_adjustment', 'manual')
      ORDER BY scenario, invoice_no
    `, [DAVORS_TENANT_ID]);

    for (const row of rows) {
      const det = detectAutoPostedIncomeRegisterEntry({
        invoice_no: row.invoice_no,
        is_system_adjustment: row.is_system_adjustment,
        client_invoice_id: row.linked ? row.id : null,
        service_category: row.service_category,
        entry_type: row.entry_type,
      });
      console.log(
        `scenario=${row.scenario} invoice=${row.invoice_no} detector.autoPosted=${det.autoPosted} kind=${det.kind}`,
      );
    }
    return rows;
  } finally {
    await client.end();
  }
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url.includes(STAGING_REF) || !key) {
    throw new Error("Staging Supabase credentials required in .env.staging.local");
  }

  // Sanity: app must be local (uncommitted lockdown not on Vercel staging)
  if (APP_URL.includes("vercel.app")) {
    throw new Error(
      "Refuse Vercel staging URL â€” lockdown is uncommitted. Start local next on :3011 with staging env.",
    );
  }

  const health = await fetch(`${APP_URL}/login`).catch(() => null);
  if (!health?.ok && health?.status !== 200 && health?.status !== 307 && health?.status !== 302) {
    throw new Error(
      `App not reachable at ${APP_URL} (status=${health?.status}). Start: npx next dev -p 3011 with staging env.`,
    );
  }

  const rows = await loadScenarioRows();
  const byScenario = Object.fromEntries(rows.map((r) => [r.scenario, r]));
  for (const need of ["client_invoice", "platform_billing", "system_adjustment", "manual"]) {
    if (!byScenario[need]) {
      record(need, false, `No staging Davors row found for scenario ${need}`);
    }
  }

  let probe: { email: string; password: string; authUid: string } | null = null;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    probe = await createProbeUser(url, key);
    await login(page, probe.email, probe.password);
    await page.goto(`${APP_URL}/dashboard/finance`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForSelector("table", { timeout: 60_000 });

    // Widen filters if needed â€” show all
    const search = page.locator('input[placeholder*="Search"], input[type="search"]');
    if ((await search.count()) > 0) {
      await search.first().fill("");
    }

    if (byScenario.client_invoice) {
      await assertLockedRow(
        page,
        "client_invoice",
        byScenario.client_invoice.invoice_no,
        "Client Invoice",
      );
    }
    if (byScenario.platform_billing) {
      await assertLockedRow(
        page,
        "platform_billing",
        byScenario.platform_billing.invoice_no,
        "Platform Billing",
      );
    }
    if (byScenario.system_adjustment) {
      await assertLockedRow(
        page,
        "system_adjustment",
        byScenario.system_adjustment.invoice_no,
        "payroll",
      );
    }
    if (byScenario.manual) {
      // Row may already be on page; avoid page.locator("input").first() (assistant widget).
      await assertManualRow(page, byScenario.manual.invoice_no);
    }
  } finally {
    await browser.close();
    if (probe) {
      await deleteProbeUser(url, key, probe.authUid).catch(() => undefined);
    }
  }

  console.log("\n=== SUMMARY ===");
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"}\t${c.scenario}\t${c.detail}`);
  }
  const failed = checks.filter((c) => !c.pass);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
