import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "landlord-units-ui.png");
const BASE = "http://localhost:3000";
const EMAIL = "info@unifaitechnologies.com";
const PASSWORD = "ikechuku";
const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await mkdir(__dirname, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    defaultViewport: { width: 1500, height: 1000 },
    args: ["--no-first-run", "--no-default-browser-check"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/landlord-portal/login`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    await page.waitForSelector("#email", { timeout: 30000 });
    await page.click("#email", { clickCount: 3 });
    await page.type("#email", EMAIL, { delay: 20 });
    await page.click("#password", { clickCount: 3 });
    await page.type("#password", PASSWORD, { delay: 20 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
      page.click('button[type="submit"]'),
    ]).catch(async () => {
      // Already navigated or soft navigation
      await sleep(2000);
    });

    for (let i = 0; i < 40; i++) {
      if (!page.url().includes("/login")) break;
      const err = await page
        .$eval("p.text-red-700, .text-red-700", (el) => el.textContent)
        .catch(() => null);
      if (err) throw new Error(`Login failed: ${err}`);
      await sleep(500);
    }
    if (page.url().includes("/login")) {
      throw new Error("Still on login after submit");
    }

    console.log("AFTER_LOGIN", page.url());
    await page.goto(`${BASE}/landlord-portal/real-estate/units`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    for (let i = 0; i < 40; i++) {
      const text = await page.evaluate(() => document.body.innerText || "");
      const info = {
        hasManage: /\bManage\b/.test(text),
        hasEdit: /Edit on property/.test(text),
        header: text.includes("Test Landlord")
          ? "landlord"
          : text.includes("Test Managed")
            ? "managed"
            : "other",
      };
      console.log("UNITS_WAIT", i, JSON.stringify(info));
      if (info.hasManage || info.hasEdit) break;
      await sleep(500);
    }

    const createStatus = await page.evaluate(async () => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const createBtn = buttons.find((b) =>
        /share apply link/i.test(b.textContent || ""),
      );
      if (createBtn && !createBtn.disabled) {
        createBtn.click();
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 250));
          const copy = Array.from(document.querySelectorAll("button")).find(
            (b) => /copy link/i.test(b.textContent || ""),
          );
          if (copy) return "created";
        }
        return "timeout";
      }
      const copy = buttons.find((b) =>
        /copy link/i.test(b.textContent || ""),
      );
      return copy ? "already" : "no-button";
    });
    console.log("CREATE_LINK", createStatus);
    await sleep(800);

    const buf = await page.screenshot({ type: "png", fullPage: false });
    await writeFile(OUT, buf);
    console.log("WROTE", OUT);

    const probe = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        hasEditDelete: /Edit on property/.test(text) && /\bDelete\b/.test(text),
        hasRawApplyUrl: /\/apply\/[a-f0-9]{16,}/i.test(text),
        hasCopy: /Copy link/i.test(text),
        hasShareApply: /Share apply link/i.test(text),
        path: location.pathname,
        header: text.includes("Test Landlord")
          ? "landlord"
          : text.includes("Test Managed")
            ? "managed"
            : "other",
      };
    });
    console.log("PROBE", JSON.stringify(probe));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
