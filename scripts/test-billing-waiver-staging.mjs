/**
 * Staging: billing waiver access path for ensureTrialAccess.
 * Usage: node scripts/test-billing-waiver-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isTrialPeriodActive(trialEndDate) {
  if (!trialEndDate) return false;
  return todayIsoDate() <= String(trialEndDate).slice(0, 10);
}

/** Mirrors utils/trial-enforcement.ts subscriptionAllowsAccess */
function subscriptionAllowsAccess(row) {
  if (row.billing_waived === true) return true;
  if (row.subscription_status === "active") return true;
  if (row.subscription_status === "trialing") {
    return isTrialPeriodActive(row.trial_end_date);
  }
  return false;
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing staging env");
assert(supabaseUrl.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

const source = readFileSync(
  resolve("utils/trial-enforcement.ts"),
  "utf8",
);
assert(source.includes("billing_waived"), "ensureTrialAccess missing billing_waived");
assert(
  source.indexOf("billing_waived") < source.indexOf('subscription_status === "active"'),
  "billing_waived check should come before active/trialing checks",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: before, error: beforeError } = await supabase
  .from("crm_subscriptions")
  .select(
    "id, linked_tenant_id, subscription_status, trial_end_date, billing_waived, billing_waived_reason, billing_waived_by, billing_waived_at",
  )
  .eq("linked_tenant_id", CAANTA)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (beforeError) throw new Error(beforeError.message);
assert(before, "Caanta subscription not found");

const original = { ...before };
console.log("Before:", original);

// 1) Waive billing
const { error: waiveError } = await supabase
  .from("crm_subscriptions")
  .update({
    billing_waived: true,
    billing_waived_reason: "STAGING TEST — partner comp",
    billing_waived_by: "staging-test@davorsfacilities.com",
    billing_waived_at: new Date().toISOString(),
  })
  .eq("id", before.id);
if (waiveError) throw new Error(waiveError.message);

// 2) Expire trial
const { error: expireError } = await supabase
  .from("crm_subscriptions")
  .update({
    trial_end_date: "2020-01-01",
    subscription_status: "trialing",
  })
  .eq("id", before.id);
if (expireError) throw new Error(expireError.message);

const { data: waivedExpired, error: weError } = await supabase
  .from("crm_subscriptions")
  .select(
    "subscription_status, trial_end_date, billing_waived, billing_waived_reason, billing_waived_by, billing_waived_at",
  )
  .eq("id", before.id)
  .single();
if (weError) throw new Error(weError.message);

console.log("Waived + expired trial:", waivedExpired);
assert(waivedExpired.billing_waived === true, "Expected billing_waived=true");
assert(
  !isTrialPeriodActive(waivedExpired.trial_end_date),
  "Trial should be expired for this test",
);
assert(
  subscriptionAllowsAccess(waivedExpired) === true,
  "ensureTrialAccess logic must GRANT access when waived even if trial expired",
);
console.log("PASS: waived + expired trial still grants access");

// 3) Un-waive — access should fail (expired trial)
const { error: unwaiveError } = await supabase
  .from("crm_subscriptions")
  .update({
    billing_waived: false,
    billing_waived_reason: null,
    billing_waived_by: null,
    billing_waived_at: null,
  })
  .eq("id", before.id);
if (unwaiveError) throw new Error(unwaiveError.message);

const { data: unwaived, error: uwError } = await supabase
  .from("crm_subscriptions")
  .select(
    "subscription_status, trial_end_date, billing_waived, billing_waived_reason",
  )
  .eq("id", before.id)
  .single();
if (uwError) throw new Error(uwError.message);

assert(unwaived.billing_waived === false, "Expected billing_waived=false");
assert(
  subscriptionAllowsAccess(unwaived) === false,
  "ensureTrialAccess logic must DENY access after un-waive with expired trial",
);
console.log("PASS: un-waived + expired trial denies access");

// Restore original trial/status/waiver fields
const { error: restoreError } = await supabase
  .from("crm_subscriptions")
  .update({
    subscription_status: original.subscription_status,
    trial_end_date: original.trial_end_date,
    billing_waived: original.billing_waived ?? false,
    billing_waived_reason: original.billing_waived_reason,
    billing_waived_by: original.billing_waived_by,
    billing_waived_at: original.billing_waived_at,
  })
  .eq("id", before.id);
if (restoreError) throw new Error(restoreError.message);

console.log("Restored original Caanta subscription row.");
console.log("ALL CHECKS PASSED");
