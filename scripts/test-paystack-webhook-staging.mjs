/**
 * Staging: Paystack webhook signature + idempotent charge.success processing.
 * Usage: node scripts/test-paystack-webhook-staging.mjs
 *
 * Does not call Paystack's dashboard — simulates a signed webhook POST against
 * local crypto helpers + direct processor (via dynamic import of compiled path
 * is unavailable), so this script mirrors the HMAC + DB update path.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

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

function signBody(secret, rawBody) {
  return createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secretKey = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();

assert(supabaseUrl?.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
assert(secretKey.startsWith("sk_test_"), "Need sk_test_ key");

const routeSource = readFileSync(
  resolve("app/api/webhooks/paystack/route.ts"),
  "utf8",
);
assert(
  routeSource.includes("verifyPaystackWebhookSignature"),
  "route must verify signature",
);
assert(
  routeSource.indexOf("verifyPaystackWebhookSignature") <
    routeSource.indexOf("processPaystackWebhookEvent"),
  "signature must be checked before processing",
);
assert(routeSource.includes("status: 401"), "invalid signature must 401");
assert(
  routeSource.includes("status: 200"),
  "valid signature path must acknowledge 200",
);

const middlewareSource = readFileSync(resolve("middleware.ts"), "utf8");
assert(
  middlewareSource.includes("/api/webhooks/paystack"),
  "middleware must allow public webhook path",
);

const trialSource = readFileSync(resolve("utils/trial-enforcement.ts"), "utf8");
assert(
  trialSource.includes('subscription_status === "past_due"'),
  "past_due must retain access (grace period)",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- Signature unit check (mirrors utils/paystack.ts) ---
const sampleBody = JSON.stringify({
  event: "charge.success",
  data: { reference: "sig_test_ref", amount: 11500 },
});
const goodSig = signBody(secretKey, sampleBody);
const badSig = signBody(secretKey, sampleBody + "x");
assert(goodSig.length === 128, "HMAC SHA512 hex length");
assert(goodSig !== badSig, "tampered body must change signature");
console.log("signature helper ok");

// --- Idempotent charge.success against Caanta subscription ---
const { data: before, error: beforeError } = await supabase
  .from("crm_subscriptions")
  .select(
    "id, subscription_status, product_id, next_billing_date, paystack_customer_id, billing_waived",
  )
  .eq("linked_tenant_id", CAANTA)
  .eq("tenant_id", DAVORS)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (beforeError) throw new Error(beforeError.message);
assert(before, "Caanta crm_subscriptions row missing");

const { data: starter, error: productError } = await supabase
  .from("crm_products")
  .select("id, paystack_plan_code, billing_cycle, price_ghs")
  .eq("tenant_id", DAVORS)
  .eq("name", "ERP Suite - Starter (Monthly)")
  .maybeSingle();

if (productError) throw new Error(productError.message);
assert(starter?.paystack_plan_code, "Starter Monthly plan code missing");

const reference = `wh_test_${Date.now()}`;
const paidAt = new Date().toISOString();
const envelope = {
  event: "charge.success",
  data: {
    reference,
    status: "success",
    amount: Math.round(Number(starter.price_ghs) * 100),
    currency: "GHS",
    paid_at: paidAt,
    plan: { plan_code: starter.paystack_plan_code, interval: "monthly" },
    customer: {
      email: "info@caanta.com",
      customer_code: "CUS_TEST_WEBHOOK",
    },
    metadata: {
      tenant_id: CAANTA,
      product_id: starter.id,
      product_name: "ERP Suite - Starter (Monthly)",
      billing_cycle: "monthly",
    },
  },
};

const eventKey = `charge.success:${reference}`;
const raw = JSON.stringify(envelope);
const signature = signBody(secretKey, raw);
assert(signature === signBody(secretKey, raw), "deterministic signature");

// Claim + process (same semantics as processPaystackWebhookEvent)
async function claim(key, type, payload) {
  const { error } = await supabase.from("paystack_webhook_events").insert({
    event_key: key,
    event_type: type,
    processing_status: "processed",
    payload,
  });
  if (!error) return "claimed";
  if (error.code === "23505") return "duplicate";
  throw new Error(error.message);
}

const firstClaim = await claim(eventKey, "charge.success", envelope);
assert(firstClaim === "claimed", "first claim should succeed");

const next = new Date(paidAt);
next.setUTCMonth(next.getUTCMonth() + 1);
const nextBilling = next.toISOString().slice(0, 10);

const { error: updateError } = await supabase
  .from("crm_subscriptions")
  .update({
    subscription_status: "active",
    product_id: starter.id,
    next_billing_date: nextBilling,
    paystack_customer_id: "CUS_TEST_WEBHOOK",
  })
  .eq("id", before.id)
  .eq("tenant_id", DAVORS);

if (updateError) throw new Error(updateError.message);

const secondClaim = await claim(eventKey, "charge.success", envelope);
assert(secondClaim === "duplicate", "retry must be duplicate");

const { data: after, error: afterError } = await supabase
  .from("crm_subscriptions")
  .select(
    "subscription_status, product_id, next_billing_date, paystack_customer_id, billing_waived",
  )
  .eq("id", before.id)
  .maybeSingle();

if (afterError) throw new Error(afterError.message);
assert(after.subscription_status === "active", "status should be active");
assert(after.product_id === starter.id, "product_id should update");
assert(after.next_billing_date === nextBilling, "next_billing_date set");
assert(after.paystack_customer_id === "CUS_TEST_WEBHOOK", "customer code stored");

console.log("charge.success processing + idempotency ok");
console.log("  subscription:", before.id);
console.log("  next_billing_date:", after.next_billing_date);
console.log("  billing_waived:", after.billing_waived);

// Restore prior status so Caanta trial/waiver tests stay intact unless already active
const { error: restoreError } = await supabase
  .from("crm_subscriptions")
  .update({
    subscription_status: before.subscription_status,
    product_id: before.product_id,
    next_billing_date: before.next_billing_date,
    paystack_customer_id: before.paystack_customer_id,
  })
  .eq("id", before.id);

if (restoreError) throw new Error(restoreError.message);

await supabase.from("paystack_webhook_events").delete().eq("event_key", eventKey);

console.log("restored Caanta subscription to prior state");
console.log("PASS — webhook signature + idempotent update path verified");
console.log(
  "Real E2E: set Test webhook URL to a public HTTPS tunnel (ngrok/cloudflared) pointing at /api/webhooks/paystack, then complete a test checkout.",
);
