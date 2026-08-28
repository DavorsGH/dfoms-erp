/**
 * Browser QA: FM-filed complaint attribution (raised_by=facility_manager).
 *
 *   npm run dev -- -p 3000
 *   npx tsx scripts/apply-251-lessee-complaints-raised-by-fm-staging.ts
 *   npx tsx scripts/test-fm-complaint-attribution-staging-browser.ts
 */
import { chromium, type Page } from "playwright";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const FM_EMAIL = "david.avors+fm@gmail.com";
const FM_PASSWORD = "FmStagingTest!2026";
const TENANT_ID = "a0792446-3bd1-4eaf-a0e8-84d089d032a0";
const FM_ID = "3b08b635-40f9-41cc-bbd5-02ef81ccb67b";
const LESSEE_PASSWORD =
  process.env.LESSEE_TEST_PASSWORD?.trim() ?? "LesseeStagingTest!2026";
const MARKER = `FM-attrib-${Date.now()}`;

type Check = { scenario: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(scenario: string, pass: boolean, detail: string) {
  checks.push({ scenario, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${scenario}: ${detail}`);
}

async function loginFm(page: Page) {
  await page.goto(`${APP_URL}/facility-portal/login`, {
    waitUntil: "load",
    timeout: 90000,
  });
  await page.locator("#email").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#email").fill(FM_EMAIL);
  await page.locator("#password").fill(FM_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/facility-portal\/(dashboard|login\/mfa)/, {
      timeout: 90000,
    }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
  if (page.url().includes("/mfa")) throw new Error("FM MFA required");
}

async function loginLessee(page: Page, email: string, password: string) {
  await page.goto(`${APP_URL}/portal/login`, {
    waitUntil: "load",
    timeout: 90000,
  });
  await page.locator("#email").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForURL(/\/portal\/(dashboard|login\/mfa)/, { timeout: 90000 }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
  if (page.url().includes("/mfa")) throw new Error("Lessee MFA required");
}

async function resolveLesseeOnFmProperty(
  admin: ReturnType<typeof createClient>,
): Promise<{ lesseeId: string; email: string; authUserId: string } | null> {
  const { data: assigns } = await admin
    .from("facility_manager_property_assignments")
    .select("property_id")
    .eq("facility_manager_id", FM_ID);
  const propIds = (assigns ?? []).map((a) => a.property_id as string);
  if (propIds.length === 0) return null;

  const { data: units } = await admin
    .from("property_units")
    .select("unit_id")
    .eq("tenant_id", TENANT_ID)
    .in("property_id", propIds);
  const unitIds = (units ?? []).map((u) => u.unit_id as string);
  if (unitIds.length === 0) return null;

  const { data: lease } = await admin
    .from("leases")
    .select("lessee_id")
    .eq("tenant_id", TENANT_ID)
    .eq("status", "active")
    .in("unit_id", unitIds)
    .limit(1)
    .maybeSingle();
  if (!lease?.lessee_id) return null;

  const { data: lessee } = await admin
    .from("lessees")
    .select("lessee_id, email, auth_user_id")
    .eq("tenant_id", TENANT_ID)
    .eq("lessee_id", lease.lessee_id)
    .maybeSingle();
  if (!lessee?.email || !lessee.auth_user_id) return null;

  return {
    lesseeId: lessee.lessee_id as string,
    email: String(lessee.email).trim().toLowerCase(),
    authUserId: lessee.auth_user_id as string,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii") || !serviceKey) {
    throw new Error("Staging Supabase credentials required (.env.staging.local)");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const lesseeAccount = await resolveLesseeOnFmProperty(admin);
  if (!lesseeAccount) {
    throw new Error("No lessee with portal auth on FM-assigned property");
  }

  let activeLessee = lesseeAccount;
  const { error: pwError } = await admin.auth.admin.updateUserById(
    activeLessee.authUserId,
    { password: LESSEE_PASSWORD, email_confirm: true },
  );
  if (pwError) throw pwError;

  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PW_CHANNEL ?? "msedge",
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  let complaintId: string | null = null;

  try {
    await loginFm(page);
    record("1. FM login", true, page.url());

    let createComplaintId: string | null = null;
    page.on("response", async (response) => {
      if (!response.url().includes("/api/facility-portal/complaints/create")) {
        return;
      }
      if (response.status() !== 200) return;
      try {
        const json = (await response.json()) as { complaint_id?: string };
        if (json.complaint_id) createComplaintId = json.complaint_id;
      } catch {
        // ignore parse errors
      }
    });

    await page.goto(`${APP_URL}/facility-portal/complaints`, {
      waitUntil: "load",
      timeout: 90000,
    });
    await page.getByRole("tab", { name: "File complaint" }).click();
    await page
      .locator("#fm-complaint-lease")
      .waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#fm-complaint-lease").selectOption({ index: 1 });
    await page.locator("#fm-complaint-subject").fill(`${MARKER} noise`);
    await page
      .locator("#fm-complaint-desc")
      .fill("After-hours noise from unit.");
    await page.getByRole("button", { name: /file complaint/i }).click();
    await page
      .getByText(/complaint filed|success/i)
      .first()
      .waitFor({ timeout: 20000 })
      .catch(() => undefined);
    await page.waitForTimeout(1500);

    let filed: {
      complaint_id: string;
      raised_by: string;
      lessee_id: string;
    } | null = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (createComplaintId) {
        const { data } = await admin
          .from("lessee_complaints")
          .select("complaint_id, raised_by, lessee_id")
          .eq("tenant_id", TENANT_ID)
          .eq("complaint_id", createComplaintId)
          .maybeSingle();
        if (data) {
          filed = data as {
            complaint_id: string;
            raised_by: string;
            lessee_id: string;
          };
          break;
        }
      }
      const { data } = await admin
        .from("lessee_complaints")
        .select("complaint_id, raised_by, lessee_id")
        .eq("tenant_id", TENANT_ID)
        .ilike("subject", `%${MARKER}%`)
        .order("created_at", { ascending: false })
        .limit(1);
      if (data?.[0]) {
        filed = data[0] as {
          complaint_id: string;
          raised_by: string;
          lessee_id: string;
        };
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    complaintId = filed?.complaint_id ?? createComplaintId;
    record(
      "2. DB raised_by=facility_manager",
      filed?.raised_by === "facility_manager",
      filed ? `raised_by=${filed.raised_by}` : "not in DB",
    );

    if (filed?.lessee_id && filed.lessee_id !== activeLessee.lesseeId) {
      const { data: complaintLessee } = await admin
        .from("lessees")
        .select("lessee_id, email, auth_user_id")
        .eq("tenant_id", TENANT_ID)
        .eq("lessee_id", filed.lessee_id)
        .maybeSingle();
      if (complaintLessee?.email && complaintLessee.auth_user_id) {
        activeLessee = {
          lesseeId: complaintLessee.lessee_id as string,
          email: String(complaintLessee.email).trim().toLowerCase(),
          authUserId: complaintLessee.auth_user_id as string,
        };
        const { error: switchPwError } = await admin.auth.admin.updateUserById(
          activeLessee.authUserId,
          { password: LESSEE_PASSWORD, email_confirm: true },
        );
        if (switchPwError) throw switchPwError;
      }
    }

    // lessee_notifications has no context column — match by title/body + recipient
    let lesseeNotif: { title: string | null; body: string | null } | null =
      null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { data } = await admin
        .from("lessee_notifications")
        .select("title, body")
        .eq("tenant_id", TENANT_ID)
        .eq("lessee_id", activeLessee.lesseeId)
        .ilike("title", "%Facility Manager%")
        .ilike("body", `%${MARKER}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        lesseeNotif = data;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    record(
      "3. Tenant notification FM wording",
      Boolean(
        lesseeNotif?.title?.includes("Facility Manager") &&
          lesseeNotif?.body?.includes("Facility Manager"),
      ),
      lesseeNotif?.title ?? "no matching lessee_notifications row",
    );

    if (complaintId) {
      const { data: staffNotif } = await admin
        .from("employee_notifications")
        .select("title, body")
        .eq("context", `complaint-fm:${complaintId}`)
        .maybeSingle();
      if (staffNotif) {
        record(
          "4. Staff in-app FM attribution",
          Boolean(
            staffNotif.title?.includes("Facility Manager") &&
              staffNotif.body?.includes("(Facility Manager)"),
          ),
          `title=${staffNotif.title}`,
        );
      } else {
        // platform_only: no employee_notifications; landlord portal inbox is the in-app path
        const { data: landlordNotif } = await admin
          .from("landlord_notifications")
          .select("title, body")
          .eq("tenant_id", TENANT_ID)
          .ilike("title", "%Facility Manager%")
          .ilike("body", `%${MARKER}%`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        record(
          "4. Staff in-app FM attribution",
          Boolean(
            landlordNotif?.title?.includes("Facility Manager") &&
              landlordNotif?.body?.includes("(Facility Manager)"),
          ),
          landlordNotif
            ? `landlord_notifications title=${landlordNotif.title}`
            : "no employee_notifications (platform_only) and no landlord_notifications match",
        );
      }
    } else {
      record("4. Staff in-app FM attribution", false, "no complaint_id");
    }

    await page.context().clearCookies();
    await loginLessee(page, activeLessee.email, LESSEE_PASSWORD);
    await page.goto(`${APP_URL}/portal/complaints`, {
      waitUntil: "load",
      timeout: 90000,
    });
    await page
      .getByText(`${MARKER} noise`)
      .first()
      .waitFor({ timeout: 45000 })
      .catch(() => undefined);

    const mainText = await page.locator("main").innerText();
    const complaintRow = page
      .locator("tr, li")
      .filter({ hasText: `${MARKER} noise` })
      .first();
    const rowText =
      (await complaintRow.count()) > 0
        ? await complaintRow.innerText()
        : mainText;
    const showsFmLabel =
      rowText.includes("From Facility Manager") &&
      rowText.includes(`${MARKER} noise`);
    record(
      "5. Tenant portal shows From Facility Manager",
      showsFmLabel,
      showsFmLabel ? "badge + subject visible" : "missing label or subject",
    );
    record(
      "5b. Tenant portal NOT From landlord for this complaint",
      showsFmLabel && !rowText.includes("From landlord"),
      showsFmLabel ? "correct badge on filed row" : "skipped",
    );

    const respondLink = complaintRow
      .getByRole("button", { name: /view\s*&\s*respond|respond/i })
      .first();
    if ((await respondLink.count()) === 0) {
      const fallbackRespond = page
        .getByRole("button", { name: /view\s*&\s*respond|respond/i })
        .first();
      if (await fallbackRespond.count()) await fallbackRespond.click();
    } else {
      await respondLink.click();
    }

    const responseBox = page.getByLabel(/your response/i).first();
    await responseBox.waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
    if ((await responseBox.count()) > 0) {
      await responseBox.click();
      await responseBox.evaluate((el, value) => {
        const textarea = el as HTMLTextAreaElement;
        const desc = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        );
        desc?.set?.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      }, `${MARKER} tenant reply`);

      const sendBtn = page.getByRole("button", { name: /send response/i });
      let clicked = false;
      const count = await sendBtn.count();
      for (let i = 0; i < count; i += 1) {
        const btn = sendBtn.nth(i);
        if ((await btn.isVisible()) && (await btn.isEnabled())) {
          await btn.click();
          clicked = true;
          break;
        }
      }
      if (!clicked && complaintId) {
        const apiResult = await page.evaluate(
          async ({ complaintId: id, response }) => {
            const res = await fetch("/api/portal/complaints/respond", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ complaint_id: id, response }),
            });
            const payload = await res.json().catch(() => ({}));
            return { ok: res.ok, status: res.status, payload };
          },
          { complaintId, response: `${MARKER} tenant reply` },
        );
        if (!apiResult.ok) {
          throw new Error(
            `respond API ${apiResult.status}: ${JSON.stringify(apiResult.payload)}`,
          );
        }
      } else if (clicked) {
        await page
          .getByText(/response sent|saved|success/i)
          .first()
          .waitFor({ timeout: 15000 })
          .catch(() => undefined);
      }
      await page.waitForTimeout(1500);
    }

    if (complaintId) {
      let saved = false;
      let detail = "no response in DB";
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const { data: after } = await admin
          .from("lessee_complaints")
          .select("staff_response, status")
          .eq("complaint_id", complaintId)
          .maybeSingle();
        if (after?.staff_response?.includes(`${MARKER} tenant reply`)) {
          saved = true;
          detail = `status=${after.status}`;
          break;
        }
        if (after?.staff_response) {
          detail = `unexpected response=${String(after.staff_response).slice(0, 80)}`;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      record("6. Tenant respond saved", saved, detail);
    } else {
      record("6. Tenant respond saved", false, "no complaint_id");
    }
  } catch (error) {
    record(
      "unexpected",
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await browser.close();
  }

  console.log("\n=== SUMMARY ===");
  for (const c of checks) {
    console.log(
      `${c.pass ? "PASS" : "FAIL"} | ${c.scenario} | ${c.detail}`,
    );
  }
  process.exit(checks.some((c) => !c.pass) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
