/**
 * Create a throwaway LIVE test tenant via production POST /api/signup.
 * Usage: node scripts/create-live-test-tenant-production.mjs
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";
const PRODUCTION_SIGNUP_URL = "https://portal.davorsfacilities.com/api/signup";
const DAVORS = "00000001-0000-4000-8000-000000000001";

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

loadEnvForce(resolve(process.cwd(), ".env.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing production Supabase env in .env.local");
assert(
  supabaseUrl.includes(PRODUCTION_PROJECT_REF),
  `REFUSING: expected production ${PRODUCTION_PROJECT_REF}, got ${supabaseUrl}`,
);

const companyName = "Paystack Live Test Co";
const adminFullName = "Paystack Live Test Admin";
// Owner mailbox (override with LIVE_TEST_ADMIN_EMAIL if needed).
const adminEmail =
  process.env.LIVE_TEST_ADMIN_EMAIL?.trim().toLowerCase() ||
  "info@davorsfacilities.com";
const password =
  process.env.LIVE_TEST_ADMIN_PASSWORD?.trim() ||
  `LiveTest-${randomBytes(9).toString("base64url")}!`;

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("Target: PRODUCTION", PRODUCTION_PROJECT_REF);
console.log("Signup API:", PRODUCTION_SIGNUP_URL);
console.log("Company:", companyName);
console.log("Email:", adminEmail);

const { data: existingAccount } = await admin
  .from("user_accounts")
  .select("auth_uid, tenant_id, email, role")
  .ilike("email", adminEmail)
  .maybeSingle();

if (existingAccount) {
  throw new Error(
    `Email already has user_accounts row (tenant_id=${existingAccount.tenant_id}). Pick another LIVE_TEST_ADMIN_EMAIL.`,
  );
}

const signupRes = await fetch(PRODUCTION_SIGNUP_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    company_name: companyName,
    admin_full_name: adminFullName,
    admin_email: adminEmail,
    password,
    confirm_password: password,
  }),
});

const signupPayload = await signupRes.json().catch(() => ({}));
if (!signupRes.ok) {
  throw new Error(
    `Signup failed (${signupRes.status}): ${signupPayload.error ?? JSON.stringify(signupPayload)}`,
  );
}

const tenantId = signupPayload.tenant_id;
assert(tenantId, "Signup response missing tenant_id");

// Ensure login works even if production still creates users with email_confirm:false
const { data: listData, error: listError } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (listError) throw new Error(listError.message);

const authUser = (listData.users ?? []).find(
  (u) => (u.email ?? "").toLowerCase() === adminEmail,
);
assert(authUser, "Auth user not found after signup");

if (!authUser.email_confirmed_at) {
  const { error: updateError } = await admin.auth.admin.updateUserById(authUser.id, {
    email_confirm: true,
  });
  if (updateError) throw new Error(`Failed to confirm email: ${updateError.message}`);
  console.log("Confirmed auth email for immediate login.");
}

const { data: tenant, error: tenantError } = await admin
  .from("tenants")
  .select("id, name, slug, status")
  .eq("id", tenantId)
  .single();
if (tenantError) throw new Error(tenantError.message);

const { data: account, error: accountError } = await admin
  .from("user_accounts")
  .select("auth_uid, tenant_id, email, role, is_active")
  .eq("tenant_id", tenantId)
  .eq("email", adminEmail)
  .single();
if (accountError) throw new Error(accountError.message);

const { data: sub, error: subError } = await admin
  .from("crm_subscriptions")
  .select(
    "id, linked_tenant_id, subscription_status, trial_end_date, customer_id, product_id, paystack_subscription_id",
  )
  .eq("tenant_id", DAVORS)
  .eq("linked_tenant_id", tenantId)
  .maybeSingle();
if (subError) throw new Error(subError.message);

console.log("\n=== LIVE TEST TENANT CREATED ===");
console.log(
  JSON.stringify(
    {
      login_url: "https://portal.davorsfacilities.com/login",
      email: adminEmail,
      password,
      tenant_id: tenantId,
      tenant_name: tenant.name,
      tenant_slug: tenant.slug,
      auth_uid: account.auth_uid,
      role: account.role,
      client_id: signupPayload.client_id ?? sub?.customer_id ?? null,
      subscription_id: sub?.id ?? null,
      subscription_status: sub?.subscription_status ?? null,
      trial_end_date: sub?.trial_end_date ?? null,
    },
    null,
    2,
  ),
);
console.log("DONE");
