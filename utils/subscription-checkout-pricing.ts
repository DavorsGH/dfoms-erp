import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getTenantCreditBalanceGhs,
  splitChargeWithAccountCredit,
  type ChargeCreditSplit,
} from "@/utils/account-credit";
import {
  customPriceAppliesToSelectedTier,
  type CustomPriceSubscriptionRow,
} from "@/utils/custom-subscription-price-tier-lock";
import { roundGhs } from "@/utils/product-sale-paystack";

export type SubscriptionPricingRow = CustomPriceSubscriptionRow & {
  custom_price_paystack_plan_code: string | null;
};

async function fetchLinkedTenantSubscriptionPricing(
  admin: SupabaseClient,
  linkedTenantId: string,
): Promise<SubscriptionPricingRow | null> {
  const { data, error } = await admin
    .from("crm_subscriptions")
    .select(
      "id, product_id, custom_price_ghs, custom_price_reason, custom_price_set_by, custom_price_set_at, custom_price_tier_product_id, custom_price_paystack_plan_code",
    )
    .eq("linked_tenant_id", linkedTenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as SubscriptionPricingRow | null) ?? null;
}

function listPriceFromSubscriptionPricing(
  tierPriceGhs: number,
  pricing: SubscriptionPricingRow | null,
  selectedProductId?: string | null,
): number {
  const tierPrice = roundGhs(tierPriceGhs);
  if (!pricing || !selectedProductId) {
    return tierPrice;
  }

  if (!customPriceAppliesToSelectedTier(pricing, selectedProductId)) {
    return tierPrice;
  }

  const parsedCustom = roundGhs(Number(pricing.custom_price_ghs));
  if (!Number.isFinite(parsedCustom) || parsedCustom <= 0) {
    return tierPrice;
  }

  return parsedCustom;
}

export async function resolveLinkedTenantSubscriptionListPriceGhs(
  admin: SupabaseClient,
  input: {
    linkedTenantId: string;
    tierPriceGhs: number;
    productId?: string | null;
  },
): Promise<number> {
  const tierPrice = roundGhs(input.tierPriceGhs);
  if (!Number.isFinite(tierPrice) || tierPrice <= 0) {
    throw new Error("Tier price must be a positive number.");
  }

  const pricing = await fetchLinkedTenantSubscriptionPricing(
    admin,
    input.linkedTenantId,
  );
  return listPriceFromSubscriptionPricing(
    tierPrice,
    pricing,
    input.productId ?? null,
  );
}

export type SubscriptionCheckoutPricing = ChargeCreditSplit & {
  tierPriceGhs: number;
  /** True when crm_subscriptions.custom_price_ghs replaces the tier list price. */
  usesCustomPriceOverride: boolean;
  customPricePaystackPlanCode: string | null;
};

export async function resolveSubscriptionCheckoutChargeSplit(
  admin: SupabaseClient,
  input: {
    linkedTenantId: string;
    tierPriceGhs: number;
    selectedProductId: string;
  },
): Promise<SubscriptionCheckoutPricing> {
  const tierPriceGhs = roundGhs(input.tierPriceGhs);
  const pricing = await fetchLinkedTenantSubscriptionPricing(
    admin,
    input.linkedTenantId,
  );
  const listPriceGhs = listPriceFromSubscriptionPricing(
    tierPriceGhs,
    pricing,
    input.selectedProductId,
  );
  const creditBalanceGhs = await getTenantCreditBalanceGhs(
    admin,
    input.linkedTenantId,
  );
  const chargeSplit = splitChargeWithAccountCredit(
    listPriceGhs,
    creditBalanceGhs,
  );
  const usesCustomPriceOverride = listPriceGhs !== tierPriceGhs;
  const customPlanCode =
    usesCustomPriceOverride &&
    typeof pricing?.custom_price_paystack_plan_code === "string"
      ? pricing.custom_price_paystack_plan_code.trim()
      : "";
  return {
    ...chargeSplit,
    tierPriceGhs,
    usesCustomPriceOverride,
    customPricePaystackPlanCode: customPlanCode || null,
  };
}

/** Expected Paystack charge after credit, honoring custom_price_ghs when set. */
export async function resolveExpectedSubscriptionPaystackAmountGhs(
  admin: SupabaseClient,
  input: {
    linkedTenantId: string;
    productId: string;
    metadataCreditAppliedGhs?: number | null;
    metadataPaystackAmountGhs?: number | null;
  },
): Promise<number | null> {
  const creditApplied = roundGhs(Number(input.metadataCreditAppliedGhs ?? 0));

  if (
    input.metadataPaystackAmountGhs != null &&
    Number.isFinite(input.metadataPaystackAmountGhs) &&
    input.metadataPaystackAmountGhs >= 0
  ) {
    return roundGhs(input.metadataPaystackAmountGhs);
  }

  const { data: product, error: productError } = await admin
    .from("crm_products")
    .select("price_ghs")
    .eq("id", input.productId)
    .maybeSingle();

  if (productError) {
    throw new Error(productError.message);
  }

  const tierPriceGhs = roundGhs(Number(product?.price_ghs));
  if (!Number.isFinite(tierPriceGhs) || tierPriceGhs <= 0) {
    return null;
  }

  const listPriceGhs = await resolveLinkedTenantSubscriptionListPriceGhs(admin, {
    linkedTenantId: input.linkedTenantId,
    tierPriceGhs,
    productId: input.productId,
  });

  return roundGhs(Math.max(0, listPriceGhs - creditApplied));
}
