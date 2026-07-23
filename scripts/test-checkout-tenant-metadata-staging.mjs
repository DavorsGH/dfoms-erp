/**
 * Staging: verify checkout initialize metadata.tenant_id for Caanta.
 * Usage: node scripts/test-checkout-tenant-metadata-staging.mjs
 *
 * Mirrors the fixed initialize route's tenant/email resolution (service role),
 * calls Paystack initialize, then verifies metadata via transaction verify.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const DELETED_OLD_CAANTA = "a9ace34d-7cc0-4825-8994-9d2bdf1dbb9a";
const MISREAD_ID = "61e8e5d9-9cdb-4b8d-9c44-ed8acc23d87b";
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

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secretKey = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();

assert(supabaseUrl?.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
assert(secretKey.startsWith("sk_test_"), "Need sk_test_ key");

const routeSource = readFileSync(
  resolve("app/api/billing/checkout/initialize/route.ts"),
  "utf8",
);
assert(routeSource.includes("tenant_id: tenantId"), "metadata must use verified tenantId");
assert(routeSource.includes('from("tenants")'), "must verify tenant exists");
assert(routeSource.includes("await cookies()"), "must resolve session user");

const authSource = readFileSync(resolve("utils/admin-auth.ts"), "utf8");
assert(
  authSource.includes("createAdminClient"),
  "requireTenantSuperAdmin must use admin client for tenant_id",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: account, error: accountError } = await supabase
  .from("user_accounts")
  .select("auth_uid, email, tenant_id, role")
  .eq("email", "info@caanta.com")
  .maybeSingle();
if (accountError) throw new Error(accountError.message);
assert(account, "Caanta user missing");
assert(account.tenant_id === CAANTA, `Expected tenant ${CAANTA}, got ${account.tenant_id}`);
assert(account.tenant_id !== DELETED_OLD_CAANTA, "Must not use deleted production Caanta id");
assert(account.tenant_id !== MISREAD_ID, "Must not use misread webhook id");

const { data: tenant } = await supabase
  .from("tenants")
  .select("id, name")
  .eq("id", account.tenant_id)
  .maybeSingle();
assert(tenant, "tenant row must exist");

const { data: deleted } = await supabase
  .from("tenants")
  .select("id")
  .eq("id", DELETED_OLD_CAANTA)
  .maybeSingle();
assert(!deleted, "a9ace34d… should not exist on staging");

const { data: billing } = await supabase
  .from("billing_settings")
  .select("email_recipient")
  .eq("tenant_id", CAANTA)
  .maybeSingle();
assert(
  billing?.email_recipient === "info@caanta.com",
  `billing email should be info@caanta.com, got ${billing?.email_recipient}`,
);

const { data: product } = await supabase
  .from("crm_products")
  .select("id, name, price_ghs, paystack_plan_code, billing_cycle")
  .eq("tenant_id", DAVORS)
  .eq("name", "ERP Suite - Starter (Monthly)")
  .maybeSingle();
assert(product?.paystack_plan_code, "Starter Monthly plan missing");

const tenantId = tenant.id;
const billingEmail =
  (billing?.email_recipient ?? "").trim() || (account.email ?? "").trim();

const initRes = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email: billingEmail,
    amount: Math.round(Number(product.price_ghs) * 100),
    plan: product.paystack_plan_code,
    callback_url:
      "http://localhost:3000/dashboard/administration/billing/callback",
    currency: "GHS",
    metadata: {
      tenant_id: tenantId,
      product_id: product.id,
      product_name: product.name,
      billing_cycle: product.billing_cycle,
    },
  }),
});
const initPayload = await initRes.json();
assert(initRes.ok && initPayload?.status, initPayload?.message ?? "initialize failed");

const reference = initPayload.data.reference;
const verifyRes = await fetch(
  `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
  { headers: { Authorization: `Bearer ${secretKey}` } },
);
const verifyPayload = await verifyRes.json();
assert(verifyRes.ok && verifyPayload?.status, verifyPayload?.message ?? "verify failed");

const meta = verifyPayload.data?.metadata ?? {};
const customerEmail = verifyPayload.data?.customer?.email ?? null;

console.log("account.tenant_id:", account.tenant_id);
console.log("metadata.tenant_id:", meta.tenant_id);
console.log("customer.email:", customerEmail);
console.log("reference:", reference);

assert(meta.tenant_id === CAANTA, `Paystack metadata.tenant_id mismatch: ${meta.tenant_id}`);
assert(meta.tenant_id === account.tenant_id, "metadata must match user_accounts.tenant_id");
assert(customerEmail === "info@caanta.com", `expected info@caanta.com, got ${customerEmail}`);

console.log("PASS — Caanta checkout metadata.tenant_id and billing email are correct");
