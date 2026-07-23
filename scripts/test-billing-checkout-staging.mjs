/**
 * Staging: Paystack checkout initialize + verify (no card charge in CI).
 * Usage: node scripts/test-billing-checkout-staging.mjs
 *
 * Initializes a TEST-mode transaction for Starter Monthly using a throwaway
 * email, then verifies the unpaid reference returns a non-success status.
 * Does not open the hosted checkout or update crm_subscriptions.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const STARTER_MONTHLY = "ERP Suite - Starter (Monthly)";
const PAYSTACK_BASE = "https://api.paystack.co";
const ERP_SUITE = "ERP Suite";

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

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secretKey = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();

assert(supabaseUrl?.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
assert(secretKey.startsWith("sk_test_"), "Need sk_test_ key");

const initRoute = readFileSync(
  resolve("app/api/billing/checkout/initialize/route.ts"),
  "utf8",
);
assert(
  initRoute.includes("initializePaystackTransaction"),
  "initialize route missing Paystack call",
);
assert(
  initRoute.includes("requireTenantSuperAdmin"),
  "initialize route must be tenant-scoped",
);
assert(
  !initRoute.includes("requireDavorsPlatformSuperAdmin"),
  "initialize must NOT be Davors-only",
);
assert(
  initRoute.includes("email_recipient"),
  "initialize must use billing_settings.email_recipient",
);

const callbackPage = readFileSync(
  resolve("app/dashboard/administration/billing/callback/page.tsx"),
  "utf8",
);
assert(
  callbackPage.includes("verifyPaystackTransaction"),
  "callback page must verify reference",
);
assert(
  !callbackPage.includes("crm_subscriptions"),
  "callback must not update crm_subscriptions",
);

const uiSource = readFileSync(
  resolve("app/dashboard/administration/billing-settings.tsx"),
  "utf8",
);
assert(
  uiSource.includes("/api/billing/checkout/initialize"),
  "Change Plan must call checkout initialize",
);
assert(
  uiSource.includes("authorization_url"),
  "Change Plan must redirect to authorization_url",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: product, error: productError } = await supabase
  .from("crm_products")
  .select("id, name, price_ghs, paystack_plan_code")
  .eq("tenant_id", DAVORS)
  .eq("category", ERP_SUITE)
  .eq("name", STARTER_MONTHLY)
  .maybeSingle();

if (productError) throw new Error(productError.message);
assert(product, `Missing product ${STARTER_MONTHLY}`);
assert(product.paystack_plan_code, "Missing paystack_plan_code");
assert(Number(product.price_ghs) > 0, "Missing price_ghs");

const amountPesewas = Math.round(Number(product.price_ghs) * 100);
const email = `checkout-test+${Date.now()}@davorsfacilities.com`;
const callbackUrl =
  "http://localhost:3000/dashboard/administration/billing/callback";

const initRes = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email,
    amount: amountPesewas,
    plan: product.paystack_plan_code,
    callback_url: callbackUrl,
    currency: "GHS",
    metadata: {
      product_id: product.id,
      staging_test: true,
    },
  }),
});

const initPayload = await initRes.json();
assert(initRes.ok && initPayload?.status, initPayload?.message ?? "initialize failed");
assert(initPayload.data?.authorization_url, "missing authorization_url");
assert(initPayload.data?.reference, "missing reference");

console.log("initialize ok");
console.log("  plan:", product.paystack_plan_code);
console.log("  amount_pesewas:", amountPesewas);
console.log("  reference:", initPayload.data.reference);
console.log("  authorization_url:", initPayload.data.authorization_url);

const verifyRes = await fetch(
  `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(initPayload.data.reference)}`,
  { headers: { Authorization: `Bearer ${secretKey}` } },
);
const verifyPayload = await verifyRes.json();
assert(verifyRes.ok && verifyPayload?.status, verifyPayload?.message ?? "verify failed");
assert(verifyPayload.data?.reference === initPayload.data.reference, "reference mismatch");
assert(
  verifyPayload.data?.status !== "success",
  "unpaid reference should not be success yet",
);

console.log("verify ok (pre-payment status:", verifyPayload.data.status + ")");
console.log("PASS — checkout initialize + verify path works in test mode");
console.log(
  "Manual: open authorization_url and pay with test card 4084084084084081 (CVV 408, any future expiry) for success, or 4084080000005408 (CVV 001) for decline.",
);
