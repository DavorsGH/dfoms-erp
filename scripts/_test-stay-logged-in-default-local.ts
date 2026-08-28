/**
 * Verify "Stay logged in" defaults to checked on all three login pages.
 *
 *   $env:APP_URL="http://localhost:3000"
 *   npx tsx scripts/_test-stay-logged-in-default-local.ts
 */
import { chromium } from "playwright";

const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const LOGIN_PAGES = [
  { name: "staff ERP", path: "/login", checkboxId: "stay-logged-in" },
  { name: "tenant portal", path: "/portal/login", checkboxId: "stay-logged-in" },
  {
    name: "landlord portal",
    path: "/landlord-portal/login",
    checkboxId: "stay-logged-in",
  },
] as const;

type Check = { step: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(step: string, pass: boolean, detail: string) {
  checks.push({ step, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
}

async function main() {
  console.log(`Target: ${APP}`);

  const browser = await chromium.launch({ headless: true });

  for (const pageDef of LOGIN_PAGES) {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${APP}${pageDef.path}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const checkbox = page.getByRole("checkbox", { name: /Stay logged in/i });
    await checkbox.waitFor({ state: "visible", timeout: 15000 }).catch(() => null);
    const visible = await checkbox.isVisible().catch(() => false);
    const checkedDefault = visible ? await checkbox.isChecked() : false;
    record(
      `${pageDef.name}: checked by default`,
      visible && checkedDefault,
      `visible=${visible} checked=${checkedDefault}`,
    );

    if (visible) {
      await checkbox.uncheck();
      const unchecked = !(await checkbox.isChecked());
      record(
        `${pageDef.name}: can uncheck`,
        unchecked,
        `checked after uncheck=${await checkbox.isChecked()}`,
      );

      await checkbox.check();
      const rechecked = await checkbox.isChecked();
      record(
        `${pageDef.name}: can re-check`,
        rechecked,
        `checked=${rechecked}`,
      );
    }

    await context.close();
  }

  await browser.close();

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
