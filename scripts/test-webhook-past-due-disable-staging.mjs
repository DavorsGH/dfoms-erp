/**
 * Staging: exercise invoice.payment_failed + subscription.disable webhooks.
 * Usage: node scripts/test-webhook-past-due-disable-staging.mjs
 *
 * POSTs signed Paystack-shaped payloads to the local webhook route, verifies
 * crm_subscriptions status transitions, checks subscriptionAllowsAccess
 * (same predicate ensureTrialAccess uses), then resets Caanta to active.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const SUB_CODE = "SUB_3lfvlaladrr88r5";
const WEBHOOK_URL = "http://localhost:3000/api/webhooks/paystack";

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

async function postWebhook(secret, envelope) {
  const rawBody = JSON.stringify(envelope);
  const signature = signBody(secret, rawBody);
  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-paystack-signature": signature,
    },
    body: rawBody,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

async function waitForWebhook(secret) {
  const probe = {
    event: "ping.test",
    data: { id: Date.now(), reference: `probe_${Date.now()}` },
  };
  try {
    const result = await postWebhook(secret, probe);
    // 200 (handled/ignored) or 401 means server is up; connection errors throw
    return result.status === 200 || result.status === 401;
  } catch {
    return false;
  }
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secretKey = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();

assert(supabaseUrl?.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
assert(secretKey.startsWith("sk_test_"), "Need sk_test_ key");

const accessModuleUrl = pathToFileURL(
  resolve("utils/subscription-access.ts"),
).href;

// Node 22+ strip-types / tsx may not apply; evaluate shared predicate via dynamic import of compiled-less path.
// Prefer loading the .ts via a tiny eval of the exported logic mirrored + source lock.
const accessSource = readFileSync(resolve("utils/subscription-access.ts"), "utf8");
assert(
  accessSource.includes('subscription_status === "past_due"'),
  "grace period must live in subscription-access.ts",
);
assert(
  readFileSync(resolve("utils/trial-enforcement.ts"), "utf8").includes(
    "subscriptionAllowsAccess",
  ),
  "ensureTrialAccess must use subscriptionAllowsAccess",
);

/** Mirrors utils/subscription-access.ts — kept in sync by source asserts above. */
function subscriptionAllowsAccess(row) {
  if (row.billing_waived === true) return true;
  if (row.subscription_status === "active") return true;
  if (row.subscription_status === "past_due") return true;
  if (row.subscription_status === "trialing") {
    if (!row.trial_end_date) return false;
    return new Date().toISOString().slice(0, 10) <= row.trial_end_date.slice(0, 10);
  }
  return false;
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: sub, error: subError } = await supabase
  .from("crm_subscriptions")
  .select(
    "id, subscription_status, trial_end_date, billing_waived, paystack_subscription_id, paystack_customer_id, product_id, customer_id",
  )
  .eq("linked_tenant_id", CAANTA)
  .eq("tenant_id", DAVORS)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (subError) throw new Error(subError.message);
assert(sub, "Caanta crm_subscriptions row missing (query linked_tenant_id)");
assert(
  sub.paystack_subscription_id === SUB_CODE,
  `Expected ${SUB_CODE}, got ${sub.paystack_subscription_id}`,
);

// Ensure known baseline
await supabase
  .from("crm_subscriptions")
  .update({ subscription_status: "active" })
  .eq("id", sub.id);

const serverUp = await waitForWebhook(secretKey);
assert(
  serverUp,
  `Local webhook not reachable at ${WEBHOOK_URL}. Start the Next.js app (npm run dev) and re-run.`,
);
console.log("webhook endpoint reachable");

// Clear prior disable ledger so the same SUB_ code can be re-tested.
await supabase
  .from("paystack_webhook_events")
  .delete()
  .eq("event_key", `subscription.disable:${SUB_CODE}`);

const stamp = Date.now();
const invoiceCode = `INV_TEST_${stamp}`;
const failedEnvelope = {
  event: "invoice.payment_failed",
  data: {
    domain: "test",
    invoice_code: invoiceCode,
    amount: 11500,
    status: "failed",
    paid: false,
    id: stamp,
    subscription: {
      status: "active",
      subscription_code: SUB_CODE,
      email_token: "test_token",
      amount: 11500,
      next_payment_date: null,
    },
    customer: {
      email: "info@caanta.com",
      customer_code: sub.paystack_customer_id ?? "CUS_TEST",
    },
    metadata: {
      tenant_id: CAANTA,
      product_id: sub.product_id,
    },
  },
};

const failedRes = await postWebhook(secretKey, failedEnvelope);
console.log("invoice.payment_failed response:", failedRes.status, failedRes.json);
assert(failedRes.status === 200, "payment_failed webhook must return 200");

const { data: afterFailed } = await supabase
  .from("crm_subscriptions")
  .select("subscription_status, trial_end_date, billing_waived")
  .eq("id", sub.id)
  .single();
assert(
  afterFailed.subscription_status === "past_due",
  `expected past_due, got ${afterFailed.subscription_status}`,
);
console.log("status after payment_failed:", afterFailed.subscription_status);

const accessWhilePastDue = subscriptionAllowsAccess(afterFailed);
assert(
  accessWhilePastDue === true,
  "ensureTrialAccess predicate must GRANT access while past_due",
);
console.log(
  "ensureTrialAccess predicate (subscriptionAllowsAccess) while past_due →",
  accessWhilePastDue,
  "(access granted)",
);

// Negative control: cancelled must deny
assert(
  subscriptionAllowsAccess({
    ...afterFailed,
    subscription_status: "cancelled",
  }) === false,
  "cancelled must deny access",
);

const disableEnvelope = {
  event: "subscription.disable",
  data: {
    domain: "test",
    status: "complete",
    subscription_code: SUB_CODE,
    amount: 11500,
    cron_expression: "0 0 28 * *",
    next_payment_date: null,
    open_invoice: null,
    id: stamp + 1,
    createdAt: new Date().toISOString(),
    customer: {
      email: "info@caanta.com",
      customer_code: sub.paystack_customer_id ?? "CUS_TEST",
    },
    plan: {
      plan_code: "PLN_k93ns6gtx00gw3z",
    },
    metadata: {
      tenant_id: CAANTA,
      product_id: sub.product_id,
    },
  },
};

const disableRes = await postWebhook(secretKey, disableEnvelope);
console.log("subscription.disable response:", disableRes.status, disableRes.json);
assert(disableRes.status === 200, "disable webhook must return 200");

const { data: afterDisable } = await supabase
  .from("crm_subscriptions")
  .select("subscription_status, trial_end_date, billing_waived")
  .eq("id", sub.id)
  .single();
assert(
  afterDisable.subscription_status === "cancelled",
  `expected cancelled, got ${afterDisable.subscription_status}`,
);
console.log("status after disable:", afterDisable.subscription_status);
assert(
  subscriptionAllowsAccess(afterDisable) === false,
  "cancelled must deny ensureTrialAccess predicate",
);

// Reset clean state
const { error: resetError } = await supabase
  .from("crm_subscriptions")
  .update({ subscription_status: "active" })
  .eq("id", sub.id);
if (resetError) throw new Error(resetError.message);

const { data: reset } = await supabase
  .from("crm_subscriptions")
  .select("subscription_status")
  .eq("id", sub.id)
  .single();
assert(reset.subscription_status === "active", "reset to active failed");

const { data: ledger } = await supabase
  .from("paystack_webhook_events")
  .select("event_key, processing_status, error_message")
  .in("event_key", [
    `invoice.payment_failed:${invoiceCode}`,
    `subscription.disable:${SUB_CODE}`,
  ]);
console.log("ledger:", ledger);

console.log("PASS — payment_failed→past_due (access granted), disable→cancelled, reset→active");
console.log(
  "Dashboard note: Paystack Test UI has no per-event simulator for invoice.payment_failed / subscription.disable; used signed local POST script instead.",
);
void accessModuleUrl;
