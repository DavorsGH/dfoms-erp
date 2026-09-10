import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logSystemEvent } from "@/lib/system-event-log";
import { roundGhs } from "@/utils/product-sale-paystack";
import { isValidUuid } from "@/utils/uuid-validation";

export type CustomPriceSubscriptionRow = {
  id: string;
  product_id: string | null;
  custom_price_ghs: number | null;
  custom_price_reason: string | null;
  custom_price_set_by: string | null;
  custom_price_set_at: string | null;
  custom_price_tier_product_id: string | null;
};

export const CUSTOM_PRICE_OVERRIDE_CLEAR_FIELDS = {
  custom_price_ghs: null,
  custom_price_reason: null,
  custom_price_set_by: null,
  custom_price_set_at: null,
  custom_price_tier_product_id: null,
} as const;

export function lockedCustomPriceTierProductId(
  row: Pick<
    CustomPriceSubscriptionRow,
    "custom_price_tier_product_id" | "product_id"
  >,
): string | null {
  const locked = row.custom_price_tier_product_id?.trim() ?? "";
  if (isValidUuid(locked)) {
    return locked;
  }

  const fallback = row.product_id?.trim() ?? "";
  if (isValidUuid(fallback)) {
    return fallback;
  }

  return null;
}

export function customPriceAppliesToSelectedTier(
  row: CustomPriceSubscriptionRow,
  selectedProductId: string,
): boolean {
  if (row.custom_price_ghs == null) {
    return false;
  }

  const parsedCustom = roundGhs(Number(row.custom_price_ghs));
  if (!Number.isFinite(parsedCustom) || parsedCustom <= 0) {
    return false;
  }

  const lockedTierProductId = lockedCustomPriceTierProductId(row);
  if (!lockedTierProductId) {
    return false;
  }

  return lockedTierProductId === selectedProductId.trim();
}

async function fetchProductName(
  admin: SupabaseClient,
  productId: string | null,
): Promise<string | null> {
  if (!productId || !isValidUuid(productId)) {
    return null;
  }

  const { data, error } = await admin
    .from("crm_products")
    .select("name")
    .eq("id", productId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const name = data?.name?.trim();
  return name || null;
}

export async function fetchLinkedTenantCustomPriceSubscription(
  admin: SupabaseClient,
  linkedTenantId: string,
): Promise<CustomPriceSubscriptionRow | null> {
  const { data, error } = await admin
    .from("crm_subscriptions")
    .select(
      "id, product_id, custom_price_ghs, custom_price_reason, custom_price_set_by, custom_price_set_at, custom_price_tier_product_id",
    )
    .eq("linked_tenant_id", linkedTenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as CustomPriceSubscriptionRow | null) ?? null;
}

/**
 * When checkout selects a tier other than the locked custom-price tier, clear the
 * override (Paystack plan code is left in place) and log the event for staff visibility.
 */
export async function clearCustomPriceOverrideOnTierMismatch(
  admin: SupabaseClient,
  input: {
    linkedTenantId: string;
    selectedProductId: string;
  },
): Promise<{ cleared: boolean }> {
  const subscription = await fetchLinkedTenantCustomPriceSubscription(
    admin,
    input.linkedTenantId,
  );

  if (!subscription || subscription.custom_price_ghs == null) {
    return { cleared: false };
  }

  if (
    customPriceAppliesToSelectedTier(subscription, input.selectedProductId)
  ) {
    return { cleared: false };
  }

  const oldCustomPriceGhs = roundGhs(Number(subscription.custom_price_ghs));
  const lockedTierProductId = lockedCustomPriceTierProductId(subscription);

  const { error: updateError } = await admin
    .from("crm_subscriptions")
    .update(CUSTOM_PRICE_OVERRIDE_CLEAR_FIELDS)
    .eq("id", subscription.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const [oldTierName, newTierName] = await Promise.all([
    fetchProductName(admin, lockedTierProductId),
    fetchProductName(admin, input.selectedProductId),
  ]);

  await logSystemEvent({
    eventType: "payment",
    eventName: "custom_price_cleared_tier_switch",
    status: "warning",
    message:
      `Custom subscription price cleared because tenant checked out a different tier ` +
      `(was locked to ${oldTierName ?? lockedTierProductId ?? "unknown"}, ` +
      `selected ${newTierName ?? input.selectedProductId}).`,
    metadata: {
      tenant_id: input.linkedTenantId,
      subscription_id: subscription.id,
      old_tier_product_id: lockedTierProductId,
      old_tier_name: oldTierName,
      new_tier_product_id: input.selectedProductId,
      new_tier_name: newTierName,
      old_custom_price_ghs: oldCustomPriceGhs,
      old_custom_price_reason: subscription.custom_price_reason,
    },
  });

  return { cleared: true };
}
