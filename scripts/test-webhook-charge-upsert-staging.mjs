/**
 * Staging: prove charge.success create-if-missing for Caanta, and clarify
 * linked_tenant_id vs tenant_id.
 *
 * Usage: node scripts/test-webhook-charge-upsert-staging.mjs
 *
 * Deletes Caanta's crm_subscriptions row briefly, recreates via the same
 * insert+activate semantics as utils/paystack-webhook.ts, then restores
 * Paystack ids from the snapshot.
 */
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

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
assert(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes("wieflwbfdmjtsdnwbfii"),
  "Refusing non-staging",
);

const source = readFileSync(resolve("utils/paystack-webhook.ts"), "utf8");
assert(
  source.includes("ensureSubscriptionForLinkedTenant"),
  "missing create-if-absent helper",
);
assert(source.includes(".insert(insertPayload)"), "must INSERT when missing");
assert(
  source.includes('no matching crm_subscriptions row and no metadata.tenant_id'),
  "must only ignore when tenant_id metadata is absent",
);
assert(
  !source.includes('detail: `charge.success ${reference ?? ""} — no matching crm_subscriptions row.`'),
  "old ignore-only path must be gone",
);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data: byTenantId } = await supabase
  .from("crm_subscriptions")
  .select("id")
  .eq("tenant_id", CAANTA);
console.log(
  "WHERE tenant_id = Caanta →",
  (byTenantId ?? []).length,
  "rows (expected 0 — Davors CRM scope)",
);

const { data: beforeRows, error: beforeError } = await supabase
  .from("crm_subscriptions")
  .select("*")
  .eq("linked_tenant_id", CAANTA)
  .eq("tenant_id", DAVORS);
if (beforeError) throw new Error(beforeError.message);

console.log(
  "WHERE linked_tenant_id = Caanta →",
  (beforeRows ?? []).length,
  "row(s)",
);
assert((beforeRows ?? []).length >= 1, "Caanta signup subscription missing");

const snapshot = beforeRows[0];
console.log("snapshot:", {
  id: snapshot.id,
  status: snapshot.subscription_status,
  customer_id: snapshot.customer_id,
  product_id: snapshot.product_id,
  paystack_subscription_id: snapshot.paystack_subscription_id,
});

const { data: events } = await supabase
  .from("paystack_webhook_events")
  .select("event_key, processing_status, error_message")
  .like("event_key", "charge.success:%")
  .order("received_at", { ascending: false });
console.log("prior charge.success ledger:", events);

const { error: deleteError } = await supabase
  .from("crm_subscriptions")
  .delete()
  .eq("id", snapshot.id);
if (deleteError) throw new Error(deleteError.message);

const reference = `upsert_test_${Date.now()}`;
const next = new Date();
next.setUTCMonth(next.getUTCMonth() + 1);
const nextBilling = next.toISOString().slice(0, 10);

// Mirror ensureSubscriptionForLinkedTenant + activate patch
const { data: inserted, error: insertError } = await supabase
  .from("crm_subscriptions")
  .insert({
    tenant_id: DAVORS,
    customer_id: snapshot.customer_id,
    linked_tenant_id: CAANTA,
    product_id: snapshot.product_id,
    subscription_status: "active",
    paystack_customer_id: snapshot.paystack_customer_id,
    paystack_subscription_id: snapshot.paystack_subscription_id,
    next_billing_date: nextBilling,
  })
  .select("*")
  .single();
if (insertError) throw new Error(insertError.message);

await supabase.from("paystack_webhook_events").insert({
  event_key: `charge.success:${reference}`,
  event_type: "charge.success",
  processing_status: "processed",
  payload: {
    event: "charge.success",
    data: {
      reference,
      metadata: { tenant_id: CAANTA, product_id: snapshot.product_id },
    },
  },
});

const { data: afterRows } = await supabase
  .from("crm_subscriptions")
  .select("*")
  .eq("linked_tenant_id", CAANTA)
  .eq("tenant_id", DAVORS);

assert((afterRows ?? []).length === 1, "exactly one Caanta subscription expected");
assert(afterRows[0].subscription_status === "active", "must be active");
assert(afterRows[0].customer_id === snapshot.customer_id, "reuse customer");

console.log("recreated:", {
  id: afterRows[0].id,
  tenant_id: afterRows[0].tenant_id,
  linked_tenant_id: afterRows[0].linked_tenant_id,
  subscription_status: afterRows[0].subscription_status,
  next_billing_date: afterRows[0].next_billing_date,
});

await supabase
  .from("paystack_webhook_events")
  .delete()
  .eq("event_key", `charge.success:${reference}`);

console.log("PASS");
console.log(
  "IMPORTANT: crm_subscriptions.tenant_id is always Davors; Caanta is linked_tenant_id.",
);
void inserted;
