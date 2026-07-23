/**
 * One-time: create Paystack Plans for crm_products ERP Suite rows (staging).
 * Idempotent — skips rows that already have paystack_plan_code.
 *
 * Requires PAYSTACK_SECRET_KEY=sk_test_... in .env.staging.local (TEST mode only).
 * Usage: node scripts/sync-paystack-plans-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const PAYSTACK_BASE = "https://api.paystack.co";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function maskKey(key) {
  if (!key || key.length < 12) return "(invalid)";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

function mapInterval(billingCycle) {
  const cycle = String(billingCycle ?? "")
    .trim()
    .toLowerCase();
  if (cycle === "monthly") return "monthly";
  if (cycle === "yearly" || cycle === "annually" || cycle === "annual") {
    return "annually";
  }
  return null;
}

function planDisplayName(productName, interval) {
  // crm names are like "ERP Suite - Starter (Monthly)" → "Davors ERP Suite - Starter (Monthly)"
  const cleaned = String(productName ?? "")
    .replace(/^ERP Suite\s*-\s*/i, "")
    .replace(/\s*\((Monthly|Yearly|Annually)\)\s*$/i, "")
    .trim();
  const cycleLabel = interval === "annually" ? "Yearly" : "Monthly";
  return `Davors ERP Suite - ${cleaned} (${cycleLabel})`;
}

function ghsToPesewas(ghs) {
  const n = Number(ghs);
  assert(Number.isFinite(n) && n > 0, `Invalid GHS amount: ${ghs}`);
  return Math.round(n * 100);
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secretKey = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();

assert(supabaseUrl && serviceRoleKey, "Missing staging Supabase env");
assert(supabaseUrl.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
assert(secretKey, "PAYSTACK_SECRET_KEY missing from .env.staging.local");
assert(
  secretKey.startsWith("sk_test_"),
  `REFUSING: PAYSTACK_SECRET_KEY must be a TEST key (sk_test_...). Got ${maskKey(secretKey)}`,
);

console.log("Paystack mode: TEST");
console.log("PAYSTACK_SECRET_KEY:", maskKey(secretKey));

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: products, error: productsError } = await supabase
  .from("crm_products")
  .select(
    "id, name, billing_cycle, price_ghs, unit_price, paystack_plan_code, category, is_active",
  )
  .eq("tenant_id", DAVORS)
  .eq("category", "ERP Suite")
  .order("name", { ascending: true });

if (productsError) throw new Error(productsError.message);

assert((products?.length ?? 0) === 8, `Expected 8 ERP Suite products, got ${products?.length ?? 0}`);

const created = [];
const skipped = [];

for (const product of products) {
  if (product.paystack_plan_code) {
    skipped.push({
      name: product.name,
      plan_code: product.paystack_plan_code,
      reason: "already set",
    });
    continue;
  }

  const interval = mapInterval(product.billing_cycle);
  assert(
    interval,
    `Unsupported billing_cycle "${product.billing_cycle}" on ${product.name}`,
  );

  assert(
    product.price_ghs != null && Number(product.price_ghs) > 0,
    `${product.name}: price_ghs is null/empty — refusing unit_price fallback (USD). Fix price_ghs first.`,
  );
  const ghsAmount = Number(product.price_ghs);
  const amountPesewas = ghsToPesewas(ghsAmount);
  const name = planDisplayName(product.name, interval);

  const response = await fetch(`${PAYSTACK_BASE}/plan`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      amount: amountPesewas,
      interval,
      currency: "GHS",
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.status) {
    throw new Error(
      `Paystack create plan failed for ${product.name}: ${payload?.message ?? response.statusText}`,
    );
  }

  const planCode = payload.data?.plan_code;
  assert(planCode, `Paystack response missing plan_code for ${product.name}`);

  const { error: updateError } = await supabase
    .from("crm_products")
    .update({ paystack_plan_code: planCode })
    .eq("id", product.id)
    .eq("tenant_id", DAVORS);

  if (updateError) {
    throw new Error(
      `Stored plan_code ${planCode} on Paystack but failed to update DB for ${product.name}: ${updateError.message}`,
    );
  }

  created.push({
    name,
    plan_code: planCode,
    interval,
    amount_pesewas: amountPesewas,
    ghs: ghsAmount,
    product_id: product.id,
  });
  console.log(`Created: ${name} → ${planCode} (${ghsAmount} GHS / ${amountPesewas}p)`);
}

console.log("\n=== CREATED ===");
console.table(created);
console.log("\n=== SKIPPED ===");
console.table(skipped);

// Verify round-trip from DB
const { data: verify, error: verifyError } = await supabase
  .from("crm_products")
  .select("name, billing_cycle, paystack_plan_code, price_ghs, unit_price")
  .eq("tenant_id", DAVORS)
  .eq("category", "ERP Suite")
  .order("name");
if (verifyError) throw new Error(verifyError.message);

const missing = (verify ?? []).filter((row) => !row.paystack_plan_code);
assert(missing.length === 0, `Still missing plan codes: ${missing.map((r) => r.name).join(", ")}`);

console.log("\n=== DB VERIFY (all 8 have paystack_plan_code) ===");
console.table(verify);
console.log("DONE");
