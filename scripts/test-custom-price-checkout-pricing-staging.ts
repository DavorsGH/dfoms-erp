/**
 * Verify Test F checkout resolves GH₵50 custom price (not tier list price).
 *
 *   npx tsx scripts/test-custom-price-checkout-pricing-staging.ts
 */
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";
import { DAVORS_TENANT_ID } from "../utils/tenant-signup";
import {
  resolveExpectedSubscriptionPaystackAmountGhs,
  resolveSubscriptionCheckoutChargeSplit,
} from "../utils/subscription-checkout-pricing";

const TEST_F_TENANT_ID = "9e7393c7-ab3a-47af-87bd-51da92fd07d4";
const PROFESSIONAL_TIER_NAME = "ERP Suite - Professional (Monthly)";

loadEnvForce(resolve(process.cwd(), ".env.local"));

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    throw new Error("Missing Supabase env vars");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: product, error: productError } = await admin
    .from("crm_products")
    .select("id, name, price_ghs")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("name", PROFESSIONAL_TIER_NAME)
    .maybeSingle();

  if (productError || !product) {
    throw new Error(productError?.message ?? `Tier not found: ${PROFESSIONAL_TIER_NAME}`);
  }

  const tierPriceGhs = Number(product.price_ghs);
  const chargeSplit = await resolveSubscriptionCheckoutChargeSplit(admin, {
    linkedTenantId: TEST_F_TENANT_ID,
    tierPriceGhs,
    selectedProductId: product.id,
  });

  console.log("Tier list price GHS:", tierPriceGhs);
  console.log("Checkout pricing:", chargeSplit);

  if (!chargeSplit.usesCustomPriceOverride) {
    throw new Error("Expected usesCustomPriceOverride=true for Test F");
  }
  if (chargeSplit.listPriceGhs !== 50) {
    throw new Error(`Expected listPriceGhs=50, got ${chargeSplit.listPriceGhs}`);
  }
  if (chargeSplit.paystackAmountGhs !== 50) {
    throw new Error(
      `Expected paystackAmountGhs=50, got ${chargeSplit.paystackAmountGhs}`,
    );
  }

  const expectedWebhook = await resolveExpectedSubscriptionPaystackAmountGhs(
    admin,
    {
      linkedTenantId: TEST_F_TENANT_ID,
      productId: product.id,
      metadataCreditAppliedGhs: 0,
      metadataPaystackAmountGhs: null,
    },
  );

  console.log("Webhook expected amount GHS:", expectedWebhook);

  if (expectedWebhook !== 50) {
    throw new Error(`Expected webhook verify amount=50, got ${expectedWebhook}`);
  }

  console.log("PASS: Custom price checkout + webhook verification use GH₵50.00");
}

main().catch((err) => {
  console.error("FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
