/**
 * Reproduce Supplier Contracts UI freeze (console + network).
 *
 *   APP_URL=http://localhost:3000 npx tsx scripts/probe-supplier-contracts-ui-freeze.ts --env-file .env.staging.local
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

loadEnvFromArgv();

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BYPASS =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ??
  "IJ7aYbMjtmTzXvZFVY1MdDdZYAlZcIDq";
const USE_BYPASS = APP_URL.includes("vercel.app");
const DAVORS_TENANT = "00000001-0000-4000-8000-000000000001";

function pageUrl(path: string) {
  const url = new URL(path, APP_URL);
  if (USE_BYPASS) {
    url.searchParams.set("x-vercel-set-bypass-cookie", "true");
    url.searchParams.set("x-vercel-protection-bypass", BYPASS);
  }
  return url.toString();
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl?.includes("wieflwbfdmjtsdnwbfii")) {
    throw new Error("Staging Supabase only");
  }
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  const email = `spc-freeze.${stamp}@test.davors`;
  const password = `SpcFreeze-${stamp}!Aa8`;

  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (userErr || !userData.user) throw userErr ?? new Error("createUser failed");

  await admin.from("user_accounts").insert({
    auth_uid: userData.user.id,
    email,
    tenant_id: DAVORS_TENANT,
    role: "super_admin",
    is_active: true,
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleLines: string[] = [];
  const apiCounts = new Map<string, number>();

  page.on("console", (msg) => {
    consoleLines.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    consoleLines.push(`pageerror: ${err.message}`);
  });
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/api/") || u.includes("supplier-contracts")) {
      const key = u.split("?")[0];
      apiCounts.set(key, (apiCounts.get(key) ?? 0) + 1);
    }
  });

  await page.goto(pageUrl("/login"), { timeout: 120_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard**", { timeout: 120_000 });

  console.log("Logged in, navigating to supplier contracts…");
  const navStart = Date.now();
  await page.goto(pageUrl("/dashboard/finance/supplier-contracts"), {
    timeout: 120_000,
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(8_000);

  const h2 = await page.getByRole("heading", { name: "Supplier Contracts" }).count();
  const newBtn = await page.getByRole("link", { name: "New supplier contract" }).count();
  const table = await page.locator("table").count();
  const maxDepth = consoleLines.filter((l) => l.includes("Maximum update depth")).length;

  console.log("\n=== Results ===");
  console.log("APP_URL:", APP_URL);
  console.log("Navigation+wait ms:", Date.now() - navStart);
  console.log("h2 Supplier Contracts:", h2);
  console.log("New supplier contract link:", newBtn);
  console.log("table count:", table);
  console.log("Maximum update depth errors:", maxDepth);
  console.log("\nAPI request counts (top):");
  for (const [url, count] of [...apiCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${count}x ${url}`);
  }
  console.log("\nConsole (first 25 lines):");
  for (const line of consoleLines.slice(0, 25)) {
    console.log(" ", line);
  }

  await browser.close();
  await admin.from("user_accounts").delete().eq("auth_uid", userData.user.id);
  await admin.auth.admin.deleteUser(userData.user.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
