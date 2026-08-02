import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "landlord-units-ui.png");
const BASE = "http://localhost:3000";
const EMAIL = "info@unifaitechnologies.com";
const PASSWORD = "ikechuku";

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    let sessionId = null;

    ws.addEventListener("open", () => {
      resolve({
        async send(method, params = {}, useSession = true) {
          const id = nextId++;
          const msg = { id, method, params };
          if (useSession && sessionId) msg.sessionId = sessionId;
          const result = new Promise((res, rej) => {
            pending.set(id, { res, rej });
          });
          ws.send(JSON.stringify(msg));
          return result;
        },
        setSession(id) {
          sessionId = id;
        },
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener("error", reject);
    ws.addEventListener("message", (ev) => {
      const data = JSON.parse(String(ev.data));
      if (data.id != null && pending.has(data.id)) {
        const { res, rej } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) rej(new Error(JSON.stringify(data.error)));
        else res(data.result);
      }
    });
  });
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await mkdir(__dirname, { recursive: true });

  const version = await fetch("http://127.0.0.1:9222/json/version").then((r) =>
    r.json(),
  );
  const browser = await wsConnect(version.webSocketDebuggerUrl);

  let targets = await browser.send("Target.getTargets", {}, false);
  let pageTarget = (targets.targetInfos || []).find(
    (t) => t.type === "page" && !String(t.url).startsWith("devtools://"),
  );
  if (!pageTarget) {
    const created = await browser.send(
      "Target.createTarget",
      { url: "about:blank" },
      false,
    );
    targets = await browser.send("Target.getTargets", {}, false);
    pageTarget = (targets.targetInfos || []).find(
      (t) => t.targetId === created.targetId,
    );
  }

  const attached = await browser.send(
    "Target.attachToTarget",
    { targetId: pageTarget.targetId, flatten: true },
    false,
  );
  browser.setSession(attached.sessionId);

  await browser.send("Page.enable");
  await browser.send("Runtime.enable");
  await browser.send("DOM.enable");
  await browser.send("Input.setIgnoreInputEvents", { ignore: false });

  async function evaluate(expression) {
    const result = await browser.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          "evaluate failed",
      );
    }
    return result.result?.value;
  }

  async function navigate(url) {
    await browser.send("Page.navigate", { url });
    for (let i = 0; i < 60; i++) {
      const ready = await evaluate("document.readyState");
      if (ready === "complete") break;
      await sleep(250);
    }
    await sleep(2000);
  }

  async function focusSelector(selector) {
    const ok = await evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.focus();
        el.click();
        return document.activeElement === el;
      })()
    `);
    if (!ok) throw new Error(`Could not focus ${selector}`);
  }

  async function clearAndType(text) {
    // Select all + delete, then insert text (works with React controlled inputs).
    await browser.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      modifiers: 2, // Ctrl
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
    });
    await browser.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      modifiers: 2,
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
    });
    await browser.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });
    await browser.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });
    await browser.send("Input.insertText", { text });
  }

  // Clear any prior landlord session so we land on Test Landlord Co (platform_only).
  await navigate(`${BASE}/landlord-portal/dashboard`);
  for (let i = 0; i < 20; i++) {
    const hasLogout = await evaluate(`
      !!([...document.querySelectorAll('button,a')]
        .find((el) => /log\\s*out/i.test(el.textContent || '')))
    `);
    if (hasLogout) break;
    await sleep(250);
  }
  const clickedLogout = await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button,a')]
        .find((el) => /log\\s*out/i.test(el.textContent || ''));
      btn?.click();
      return !!btn;
    })()
  `);
  console.log("LOGOUT_CLICK", clickedLogout);
  for (let i = 0; i < 40; i++) {
    const path = await evaluate("location.pathname");
    console.log("LOGOUT_WAIT", i, path);
    if (String(path).includes("/login")) break;
    await sleep(500);
  }

  await navigate(`${BASE}/landlord-portal/login`);
  console.log("START_PATH", await evaluate("location.pathname"));

  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(
      "!!document.getElementById('email') && !!document.getElementById('password')",
    );
    if (ready) break;
    await sleep(250);
  }
  if (!(await evaluate("!!document.getElementById('email')"))) {
    // Still authenticated — clear storage and retry login page.
    await evaluate(`
      (async () => {
        try { localStorage.clear(); sessionStorage.clear(); } catch {}
        const keys = await caches?.keys?.() || [];
        await Promise.all(keys.map((k) => caches.delete(k)));
      })()
    `);
    await browser.send("Network.clearBrowserCookies").catch(() => null);
    await navigate(`${BASE}/landlord-portal/login`);
    await sleep(1500);
  }
  if (!(await evaluate("!!document.getElementById('email')"))) {
    throw new Error("Login form not found after logout");
  }

  await focusSelector("#email");
  await clearAndType(EMAIL);
  await focusSelector("#password");
  await clearAndType(PASSWORD);

  const values = await evaluate(`
    ({
      email: document.getElementById('email')?.value || '',
      passwordLen: (document.getElementById('password')?.value || '').length,
    })
  `);
  console.log("TYPED", JSON.stringify(values));

  await evaluate(`document.querySelector('button[type="submit"]')?.click()`);

  for (let i = 0; i < 50; i++) {
    const info = await evaluate(`
      ({
        path: location.pathname,
        error: document.querySelector('p.text-red-700, .text-red-700')?.textContent || null,
        button: document.querySelector('button[type="submit"]')?.textContent || null,
        header: document.body.innerText.includes('Test Landlord') ? 'landlord' : (document.body.innerText.includes('Test Managed') ? 'managed' : 'other'),
      })
    `);
    console.log("WAIT", i, JSON.stringify(info));
    if (info?.path && !String(info.path).includes("/login")) break;
    if (info?.error) break;
    await sleep(500);
  }

  const afterLogin = await evaluate(`
    ({
      path: location.pathname,
      error: document.querySelector('p.text-red-700, .text-red-700')?.textContent || null,
      bodySnippet: (document.body.innerText || '').slice(0, 400),
    })
  `);
  console.log("AFTER_LOGIN", JSON.stringify(afterLogin));
  if (String(afterLogin?.path || "").includes("/login")) {
    throw new Error(
      `Still on login: ${afterLogin?.error || afterLogin?.bodySnippet}`,
    );
  }

  await navigate(`${BASE}/landlord-portal/real-estate/units`);
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(`
      ({
        hasManage: /\\bManage\\b/.test(document.body.innerText || ''),
        hasEdit: /Edit on property/.test(document.body.innerText || ''),
        hasUnits: /UNITS/i.test(document.body.innerText || ''),
        header: (document.body.innerText || '').includes('Test Landlord')
          ? 'landlord'
          : (document.body.innerText || '').includes('Test Managed')
            ? 'managed'
            : 'other',
      })
    `);
    console.log("UNITS_WAIT", i, JSON.stringify(ready));
    if (ready?.hasUnits && (ready.hasManage || ready.hasEdit || i > 15)) break;
    await sleep(500);
  }

  const createStatus = await evaluate(`
    (async () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const createBtn = buttons.find(b => /share apply link/i.test(b.textContent || ''));
      if (createBtn && !createBtn.disabled) {
        createBtn.click();
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 250));
          const copy = Array.from(document.querySelectorAll('button'))
            .find(b => /copy link/i.test(b.textContent || ''));
          if (copy) return 'created';
        }
        return 'timeout';
      }
      const copy = buttons.find(b => /copy link/i.test(b.textContent || ''));
      return copy ? 'already' : 'no-button';
    })()
  `);
  console.log("CREATE_LINK", createStatus);
  await sleep(800);

  await browser.send("Emulation.setDeviceMetricsOverride", {
    width: 1500,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(400);

  const shot = await browser.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  await writeFile(OUT, Buffer.from(shot.data, "base64"));
  console.log("WROTE", OUT);

  const probe = await evaluate(`
    (() => {
      const text = document.body.innerText || '';
      return {
        hasEditDelete: /Edit on property/.test(text) && /\\bDelete\\b/.test(text),
        hasRawApplyUrl: /\\/apply\\/[a-f0-9]{16,}/i.test(text),
        hasCopy: /Copy link/i.test(text),
        path: location.pathname,
      };
    })()
  `);
  console.log("PROBE", JSON.stringify(probe));
  browser.close();
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
