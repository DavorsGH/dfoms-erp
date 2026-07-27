/**
 * Staging: tier feature gating for UI routes.
 * Usage: node scripts/test-tier-feature-gate-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const STARTER_MONTHLY = "e5da2b8d-6975-4642-8bca-9a7054b3dbe0";
const PROFESSIONAL_MONTHLY = "c2942461-1e49-4f2d-956e-927deab08efb";

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
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Source wiring checks
const opsLayout = readFileSync(
  resolve(process.cwd(), "app/dashboard/operations/layout.tsx"),
  "utf8",
);
assert(
  opsLayout.includes('requireFeatureAccess("operations")'),
  "operations layout missing feature gate",
);
assert(
  readFileSync(
    resolve(process.cwd(), "app/dashboard/crm/email-promotions/layout.tsx"),
    "utf8",
  ).includes('requireFeatureAccess("email_promotions")'),
  "email-promotions nested layout missing",
);
assert(
  readFileSync(
    resolve(process.cwd(), "utils/tier-access.ts"),
    "utf8",
  ).includes("/dashboard/upgrade-required?feature="),
  "tier-access missing upgrade redirect",
);
assert(
  readFileSync(
    resolve(process.cwd(), "app/dashboard/reports/operations/layout.tsx"),
    "utf8",
  ).includes('featureKey="operations"'),
  "operations reports missing featureKey",
);
assert(
  !readFileSync(
    resolve(process.cwd(), "app/dashboard/reports/finance/layout.tsx"),
    "utf8",
  ).includes("featureKey"),
  "finance reports should not gate",
);

const { data: sub } = await admin
  .from("crm_subscriptions")
  .select("id, product_id, product:crm_products(name)")
  .eq("linked_tenant_id", CAANTA)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
assert(sub?.id, "Caanta subscription missing");
const originalProductId = sub.product_id;
const product = Array.isArray(sub.product) ? sub.product[0] : sub.product;
console.log("Caanta current product:", product?.name ?? sub.product_id);

async function featuresFor(label) {
  const out = {};
  for (const key of [
    "operations",
    "crm_core",
    "pos",
    "inventory",
    "email_promotions",
  ]) {
    const { data, error } = await admin.rpc("tenant_has_feature", {
      p_tenant_id: CAANTA,
      p_feature_key: key,
    });
    assert(!error, `${key}: ${error?.message}`);
    out[key] = data === true;
  }
  console.log(label, out);
  return out;
}

try {
  // Ensure Starter
  if (originalProductId !== STARTER_MONTHLY) {
    await admin
      .from("crm_subscriptions")
      .update({ product_id: STARTER_MONTHLY })
      .eq("id", sub.id);
  }

  const starter = await featuresFor("Starter features:");
  assert(starter.operations === false, "Starter should lack operations");
  assert(starter.crm_core === false, "Starter should lack crm_core");
  assert(starter.pos === false, "Starter should lack pos");
  assert(starter.inventory === false, "Starter should lack inventory");
  assert(
    starter.email_promotions === false,
    "Starter should lack email_promotions",
  );

  // Simulate requireFeatureAccess redirect decision for Starter
  const wouldRedirectOps = !starter.operations;
  assert(wouldRedirectOps, "Starter ops should redirect to upgrade-required");
  const redirectUrl = `/dashboard/upgrade-required?feature=${encodeURIComponent("operations")}`;
  console.log("Starter /dashboard/operations →", redirectUrl);

  // Professional unlocks operations + crm_core
  const { error: upErr } = await admin
    .from("crm_subscriptions")
    .update({ product_id: PROFESSIONAL_MONTHLY })
    .eq("id", sub.id);
  assert(!upErr, upErr?.message);

  const pro = await featuresFor("Professional features:");
  assert(pro.operations === true, "Professional should have operations");
  assert(pro.crm_core === true, "Professional should have crm_core");
  assert(pro.pos === false, "Professional should lack pos");
  assert(pro.inventory === false, "Professional should lack inventory");
  assert(
    pro.email_promotions === false,
    "Professional should lack email_promotions",
  );
  console.log(
    "Professional /dashboard/operations → allow (tenant_has_feature true)",
  );

  // Messaging maps (from source — no TS loader needed)
  const tierSrc = readFileSync(
    resolve(process.cwd(), "utils/tier-access.ts"),
    "utf8",
  );
  assert(tierSrc.includes('operations: "Operations"'), "label map");
  assert(tierSrc.includes('operations: "Professional"'), "min plan map");
  assert(tierSrc.includes('email_promotions: "Enterprise"'), "enterprise map");
  assert(
    tierSrc.includes('pos: "Business"') && tierSrc.includes('inventory: "Business"'),
    "business min plans",
  );
  console.log(
    "Upgrade page copy for operations: Operations → Professional+",
  );
} finally {
  await admin
    .from("crm_subscriptions")
    .update({ product_id: originalProductId ?? STARTER_MONTHLY })
    .eq("id", sub.id);
  const { data: restored } = await admin
    .from("crm_subscriptions")
    .select("product:crm_products(name)")
    .eq("id", sub.id)
    .maybeSingle();
  const restoredProduct = Array.isArray(restored?.product)
    ? restored.product[0]
    : restored?.product;
  console.log("Restored Caanta product:", restoredProduct?.name ?? "ok");
}

console.log("\nALL TIER FEATURE GATE CHECKS PASSED");
