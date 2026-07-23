/**
 * Staging: Tier Pricing → Paystack plan amount sync (115 → 116 → 115).
 * Usage: node scripts/test-tier-pricing-paystack-sync-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const STARTER_MONTHLY = "ERP Suite - Starter (Monthly)";
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
  resolve("app/api/admin/tenants/update-pricing/route.ts"),
  "utf8",
);
assert(
  routeSource.includes("updatePaystackPlanAmount"),
  "update-pricing route missing Paystack sync",
);
assert(
  routeSource.includes("warning:"),
  "update-pricing route should surface Paystack warnings without rolling back DB",
);

const uiSource = readFileSync(
  resolve("app/dashboard/administration/tier-pricing.tsx"),
  "utf8",
);
assert(uiSource.includes("warning"), "tier-pricing UI missing warning state");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchPaystackAmount(planCode) {
  const res = await fetch(`${PAYSTACK_BASE}/plan/${planCode}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const payload = await res.json();
  if (!res.ok || !payload?.status) {
    throw new Error(payload?.message ?? `fetch plan failed ${res.status}`);
  }
  return payload.data.amount;
}

/** Mirrors update-pricing route after-auth path */
async function savePricingLikeApi({ id, unit_price, price_ghs, planCode, previousGhs }) {
  const { error: updateError } = await supabase
    .from("crm_products")
    .update({ unit_price, price_ghs })
    .eq("id", id)
    .eq("tenant_id", DAVORS);
  if (updateError) throw new Error(updateError.message);

  const ghsChanged =
    previousGhs === null ||
    !Number.isFinite(previousGhs) ||
    previousGhs !== price_ghs;

  if (!ghsChanged) {
    return { paystack_synced: false, skipped: "unchanged" };
  }

  if (!planCode) {
    return {
      paystack_synced: false,
      warning: "no plan code",
    };
  }

  const amountPesewas = Math.round(price_ghs * 100);
  const res = await fetch(`${PAYSTACK_BASE}/plan/${planCode}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: amountPesewas, currency: "GHS" }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || payload?.status === false) {
    return {
      paystack_synced: false,
      warning: payload?.message ?? "Paystack failed",
      db_saved: true,
    };
  }
  return { paystack_synced: true, planCode, amountPesewas };
}

const { data: row, error: rowError } = await supabase
  .from("crm_products")
  .select("id, name, unit_price, price_ghs, paystack_plan_code")
  .eq("tenant_id", DAVORS)
  .eq("name", STARTER_MONTHLY)
  .maybeSingle();
if (rowError) throw new Error(rowError.message);
assert(row, "Starter Monthly not found");
assert(row.paystack_plan_code, "Starter Monthly missing paystack_plan_code");

const originalGhs = Number(row.price_ghs);
const unitPrice = Number(row.unit_price);
const planCode = row.paystack_plan_code;
console.log("Before:", {
  name: row.name,
  price_ghs: originalGhs,
  plan_code: planCode,
  paystack_amount: await fetchPaystackAmount(planCode),
});

// 115 → 116
const to116 = await savePricingLikeApi({
  id: row.id,
  unit_price: unitPrice,
  price_ghs: 116,
  planCode,
  previousGhs: originalGhs,
});
assert(to116.paystack_synced === true, `Expected Paystack sync: ${JSON.stringify(to116)}`);

const { data: db116, error: db116Error } = await supabase
  .from("crm_products")
  .select("price_ghs")
  .eq("id", row.id)
  .single();
if (db116Error) throw new Error(db116Error.message);
assert(Number(db116.price_ghs) === 116, `DB expected 116, got ${db116.price_ghs}`);

const paystack116 = await fetchPaystackAmount(planCode);
assert(paystack116 === 11600, `Paystack expected 11600, got ${paystack116}`);
console.log("PASS: 115 → 116 (DB + Paystack 11600p)");

// 116 → 115
const to115 = await savePricingLikeApi({
  id: row.id,
  unit_price: unitPrice,
  price_ghs: 115,
  planCode,
  previousGhs: 116,
});
assert(to115.paystack_synced === true, `Expected Paystack sync revert: ${JSON.stringify(to115)}`);

const { data: db115, error: db115Error } = await supabase
  .from("crm_products")
  .select("price_ghs")
  .eq("id", row.id)
  .single();
if (db115Error) throw new Error(db115Error.message);
assert(Number(db115.price_ghs) === 115, `DB expected 115, got ${db115.price_ghs}`);

const paystack115 = await fetchPaystackAmount(planCode);
assert(paystack115 === 11500, `Paystack expected 11500, got ${paystack115}`);
console.log("PASS: 116 → 115 revert (DB + Paystack 11500p)");

console.log("ALL CHECKS PASSED");
